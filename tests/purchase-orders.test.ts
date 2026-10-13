import { Prisma } from '@prisma/client';
import { PurchaseOrderService } from '../src/modules/purchase-orders/purchaseOrder.service';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => {
  const prismaMock: any = {
    purchaseOrder: { findFirst: jest.fn(), update: jest.fn() },
    purchaseOrderItem: { update: jest.fn(), findMany: jest.fn() },
    stockBatch: { create: jest.fn() },
    stockLedgerEntry: { create: jest.fn(), aggregate: jest.fn() },
    item: { update: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  return { prisma: prismaMock };
});

jest.mock('../src/modules/notifications/notification.service', () => ({
  NotificationService: { notifyPOStatusChanged: jest.fn().mockResolvedValue(undefined) },
}));

const OUTLET = 'outlet-bandra';
const dec = (n: number) => new Prisma.Decimal(n);

// "Test Milk": ordered 10 L at ₹60 (6000 paise); item master price currently ₹50
const poItem = (overrides: any = {}) => ({
  id: 'poi-milk',
  itemId: 'item-milk',
  orderedQuantity: dec(10),
  receivedQuantity: dec(0),
  damagedQuantity: dec(0),
  unitCostPaise: 6000,
  item: { name: 'Test Milk', unitCostPaise: 5000 },
  ...overrides,
});

const mockPO = (status: string, items = [poItem()]) =>
  (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue({ id: 'po-1', status, outletId: OUTLET, items });

// After the receive, the reloaded PO items reflect what was just written
const mockReloadedItems = (received: number, damaged: number) =>
  (prisma.purchaseOrderItem.findMany as jest.Mock).mockResolvedValue([
    { orderedQuantity: dec(10), receivedQuantity: dec(received), damagedQuantity: dec(damaged) },
  ]);

const receive = (receivedQuantity: number, damagedQuantity = 0) =>
  new PurchaseOrderService().receivePO(OUTLET, 'po-1', [
    { itemId: 'item-milk', receivedQuantity, damagedQuantity, batchNumber: 'BCH-1', expiryDate: new Date('2026-10-10') },
  ]);

describe('Purchase orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.purchaseOrder.update as jest.Mock).mockImplementation(({ data }: any) => ({ id: 'po-1', ...data }));
    (prisma.stockLedgerEntry.aggregate as jest.Mock).mockResolvedValue({ _sum: { change: dec(0) } });
  });

  it('only finds POs belonging to the current outlet', async () => {
    mockPO('SENT');
    mockReloadedItems(10, 0);
    await receive(10);
    expect((prisma.purchaseOrder.findFirst as jest.Mock).mock.calls[0][0].where).toMatchObject({ id: 'po-1', outletId: OUTLET });
  });

  describe('13c — damaged goods', () => {
    it('records damaged quantity, keeps it out of stock, and completes the PO when everything is accounted for', async () => {
      mockPO('SENT');
      mockReloadedItems(8, 2);

      const result: any = await receive(8, 2);

      expect(prisma.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'poi-milk' },
        data: { receivedQuantity: dec(8), damagedQuantity: dec(2) },
      });
      // Only the 8 accepted litres enter stock
      expect((prisma.stockLedgerEntry.create as jest.Mock).mock.calls[0][0].data.change).toEqual(dec(8));
      expect(result.status).toBe('RECEIVED');
    });

    it('rejects received + damaged that exceeds the ordered quantity', async () => {
      mockPO('SENT');
      await expect(receive(8, 3)).rejects.toThrow('would exceed ordered (10)');
    });
  });

  describe('13d — purchase price', () => {
    it('updates the item cost to the weighted average of stock on hand and the new delivery', async () => {
      mockPO('SENT');
      mockReloadedItems(10, 0);
      // 10 L already in stock at ₹50, receiving 10 L at ₹60 → ₹55
      (prisma.stockLedgerEntry.aggregate as jest.Mock).mockResolvedValue({ _sum: { change: dec(10) } });

      await receive(10);

      expect(prisma.item.update).toHaveBeenCalledWith({ where: { id: 'item-milk' }, data: { unitCostPaise: 5500 } });
    });

    it('uses the purchase price directly when there is no stock on hand', async () => {
      mockPO('SENT');
      mockReloadedItems(10, 0);

      await receive(10);

      expect(prisma.item.update).toHaveBeenCalledWith({ where: { id: 'item-milk' }, data: { unitCostPaise: 6000 } });
    });
  });

  describe('13a — cancel', () => {
    it('cancels an order that has not been received, with a reason', async () => {
      mockPO('SENT');
      const result: any = await new PurchaseOrderService().cancelPO(OUTLET, 'po-1', 'Found a cheaper supplier');
      expect(result.status).toBe('CANCELLED');
      expect(result.closedReason).toBe('Found a cheaper supplier');
      expect(result.closedAt).toBeInstanceOf(Date);
    });

    it('refuses to cancel once something was received (use close instead)', async () => {
      mockPO('PARTIALLY_RECEIVED', [poItem({ receivedQuantity: dec(3) })]);
      await expect(new PurchaseOrderService().cancelPO(OUTLET, 'po-1', undefined)).rejects.toThrow('Use "Close order"');
    });

    it('does not allow receiving stock on a cancelled order', async () => {
      mockPO('CANCELLED');
      await expect(receive(5)).rejects.toThrow('Cannot receive items on a cancelled purchase order');
    });
  });

  describe('13b — close short', () => {
    it('closes a partially received order so the rest is no longer expected', async () => {
      mockPO('PARTIALLY_RECEIVED', [poItem({ receivedQuantity: dec(3) })]);
      const result: any = await new PurchaseOrderService().closePO(OUTLET, 'po-1', 'Rest out of stock at supplier');
      expect(result.status).toBe('CLOSED');
      expect(result.closedReason).toBe('Rest out of stock at supplier');
    });

    it('refuses to close an order where nothing was received (use cancel instead)', async () => {
      mockPO('SENT');
      await expect(new PurchaseOrderService().closePO(OUTLET, 'po-1', undefined)).rejects.toThrow('Use "Cancel order"');
    });

    it('refuses to close an order that is already completed', async () => {
      mockPO('RECEIVED', [poItem({ receivedQuantity: dec(10) })]);
      await expect(new PurchaseOrderService().closePO(OUTLET, 'po-1', undefined)).rejects.toThrow('already received');
    });
  });
});
