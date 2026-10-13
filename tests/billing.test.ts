import { Prisma } from '@prisma/client';
import { calculateBill } from '../src/modules/orders/billing';
import { OrderService } from '../src/modules/orders/order.service';
import { DashboardService } from '../src/modules/analytics/dashboard.service';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => {
  const prismaMock: any = {
    order: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    orderItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    payment: { create: jest.fn() },
    recipe: { findMany: jest.fn().mockResolvedValue([]) },
    table: { updateMany: jest.fn() },
    orderStatusHistory: { create: jest.fn() },
    wasteLog: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { count: jest.fn().mockResolvedValue(0) },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  return { prisma: prismaMock };
});
jest.mock('../src/modules/notifications/notification.service', () => ({
  NotificationService: { notifyOrderPlaced: jest.fn().mockResolvedValue(undefined), notifyOrderReady: jest.fn().mockResolvedValue(undefined) },
}));

const dec = (n: number) => new Prisma.Decimal(n);
const RATES = { cgstRate: 2.5, sgstRate: 2.5, serviceChargeRate: 10 };

// Table 1 from the real bill: round 1 Kepsa ₹100 + Chocolate Cake ₹850, round 2 Butter Chicken ₹500
const TABLE_1_ITEMS = [
  { unitPricePaise: 10_000, quantity: 1 },
  { unitPricePaise: 85_000, quantity: 1 },
  { unitPricePaise: 50_000, quantity: 1 },
];

describe('calculateBill — the single bill calculation', () => {
  it('Table 1: service charge on the whole bill, GST on food + service charge, rounded to the rupee', () => {
    const bill = calculateBill(TABLE_1_ITEMS, RATES, { dineIn: true });
    expect(bill).toMatchObject({
      subtotalPaise: 145_000,
      serviceChargePaise: 14_500, // ₹145 (not ₹95)
      taxableValuePaise: 159_500,
      cgstPaise: 3_988, // ₹39.88
      sgstPaise: 3_988,
      roundOffPaise: 24, // +₹0.24
      totalPaise: 167_500, // ₹1,675.00
    });
  });

  it('no service charge on counter / takeaway orders', () => {
    const bill = calculateBill(TABLE_1_ITEMS, RATES, { dineIn: false });
    expect(bill.serviceChargePaise).toBe(0);
    expect(bill.cgstPaise).toBe(3_625); // 2.5% of ₹1,450
    expect(bill.appliedRates.serviceChargeRate).toBe(0);
  });

  it('removes the service charge when the customer declines it', () => {
    const bill = calculateBill(TABLE_1_ITEMS, RATES, { dineIn: true, serviceChargeWaived: true });
    expect(bill.serviceChargePaise).toBe(0);
    expect(bill.totalPaise).toBe(152_300); // 1,450 + 36.25 + 36.25 = ₹1,522.50 → ₹1,523
  });

  it.each(['COMPOSITION', 'UNREGISTERED'] as const)('%s businesses do not charge GST', (type) => {
    const bill = calculateBill(TABLE_1_ITEMS, RATES, { dineIn: true, gstRegistrationType: type });
    expect(bill.cgstPaise).toBe(0);
    expect(bill.sgstPaise).toBe(0);
    expect(bill.serviceChargePaise).toBe(14_500);
    expect(bill.totalPaise).toBe(159_500);
  });

  it('rounds up and down to the nearest rupee', () => {
    // ₹999: CGST/SGST ₹24.98 each → ₹1,048.96 → ₹1,049 (+0.04)
    const up = calculateBill([{ unitPricePaise: 99_900, quantity: 1 }], RATES, { dineIn: false });
    expect(up.totalPaise).toBe(104_900);
    expect(up.roundOffPaise).toBe(4);
    // ₹1,001: CGST/SGST ₹25.03 each → ₹1,051.06 → ₹1,051 (−0.06)
    const down = calculateBill([{ unitPricePaise: 100_100, quantity: 1 }], RATES, { dineIn: false });
    expect(down.totalPaise).toBe(105_100);
    expect(down.roundOffPaise).toBe(-6);
  });

  it('applies a discount before service charge and GST', () => {
    const bill = calculateBill([{ unitPricePaise: 100_000, quantity: 1 }], RATES, { dineIn: true, discountPaise: 10_000 });
    expect(bill.serviceChargePaise).toBe(9_000); // 10% of ₹900
    expect(bill.cgstPaise).toBe(2_475); // 2.5% of ₹990
  });
});

describe('OrderService bill lifecycle', () => {
  const service = new OrderService();

  const openTable1 = (overrides: any = {}) => ({
    id: 'order-1',
    outletId: 'outlet-1',
    source: 'TABLE',
    status: 'SENT_TO_KITCHEN',
    tableNumber: 1,
    discountPaise: 0,
    serviceChargeWaived: false,
    // Snapshot taken when the bill was opened
    cgstRate: dec(2.5),
    sgstRate: dec(2.5),
    serviceChargeRate: dec(10),
    items: TABLE_1_ITEMS.map((i, idx) => ({ ...i, id: `item-${idx}`, status: 'SENT_TO_KITCHEN' })),
    outlet: { cgstRateDecimal: dec(2.5), sgstRateDecimal: dec(2.5), serviceTaxRateDecimal: dec(10), gstRegistrationType: 'REGULAR' },
    payments: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.order.update as jest.Mock).mockImplementation(({ data }: any) => ({ ...openTable1(), ...data }));
  });

  it('recalculates the whole bill after a new round (fixes the missing service charge)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(openTable1());
    await service.recalculateOrder('order-1');
    const saved = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
    expect(saved).toMatchObject({
      subtotalPaise: 145_000,
      serviceTaxPaise: 14_500,
      cgstPaise: 3_988,
      sgstPaise: 3_988,
      taxPaise: 3_988 + 3_988 + 14_500,
      roundOffPaise: 24,
      totalPaise: 167_500,
    });
  });

  it('keeps the rates of the open bill even if outlet settings change mid-service', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(
      openTable1({ outlet: { cgstRateDecimal: dec(9), sgstRateDecimal: dec(9), serviceTaxRateDecimal: dec(0), gstRegistrationType: 'REGULAR' } })
    );
    await service.recalculateOrder('order-1');
    const saved = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
    expect(saved.serviceTaxPaise).toBe(14_500);
    expect(saved.cgstPaise).toBe(3_988);
  });

  it('bills created before snapshots existed take the outlet rates once', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(openTable1({ cgstRate: null, sgstRate: null, serviceChargeRate: null }));
    await service.recalculateOrder('order-1');
    const saved = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
    expect(Number(saved.serviceChargeRate)).toBe(10);
    expect(saved.totalPaise).toBe(167_500);
  });

  it('settlement records a payment for the final recalculated total', async () => {
    // findOrderById (old, wrongly-added amounts) → recalculation → payment of the correct total
    (prisma.order.findFirst as jest.Mock).mockResolvedValue({ ...openTable1(), totalPaise: 166_750 });
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(openTable1());

    await service.updateOrderStatus('outlet-1', 'order-1', 'COMPLETED', undefined, 'user-1', 'UPI');

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', amountPaise: 167_500, method: 'UPI', status: 'CONFIRMED' },
    });
  });

  describe('removing the service charge', () => {
    it('needs a reason, and recalculates the bill without it', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(openTable1());
      await expect(service.setServiceChargeWaiver('outlet-1', 'order-1', true, '  ', 'user-1')).rejects.toThrow(
        'Please give a reason'
      );

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(openTable1({ serviceChargeWaived: true }));
      await service.setServiceChargeWaiver('outlet-1', 'order-1', true, 'Customer declined', 'user-1');

      const waiverUpdate = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(waiverUpdate).toMatchObject({
        serviceChargeWaived: true,
        serviceChargeWaivedById: 'user-1',
        serviceChargeWaiveReason: 'Customer declined',
      });
      const recalculated = (prisma.order.update as jest.Mock).mock.calls[1][0].data;
      expect(recalculated.serviceTaxPaise).toBe(0);
    });

    it('is refused on a settled bill', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(openTable1({ status: 'COMPLETED' }));
      await expect(service.setServiceChargeWaiver('outlet-1', 'order-1', true, 'x', 'user-1')).rejects.toMatchObject({
        code: 'BILL_CLOSED',
      });
    });

    it('is refused on counter orders (no service charge there)', async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(openTable1({ source: 'COUNTER' }));
      await expect(service.setServiceChargeWaiver('outlet-1', 'order-1', true, 'x', 'user-1')).rejects.toMatchObject({
        code: 'NOT_DINE_IN',
      });
    });

    it("can't reach another business's bill", async () => {
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.setServiceChargeWaiver('all', 'order-1', true, 'x', 'user-1', 'biz-other')
      ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
      expect((prisma.order.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: 'biz-other' });
    });
  });
});

describe('Dashboard: GST collected excludes service charge', () => {
  it('reports CGST + SGST as GST and service charge separately', async () => {
    (prisma.order.findMany as jest.Mock).mockImplementation(({ where }: any) =>
      where.status === 'COMPLETED' && where.createdAt.gte > new Date('2026-01-01')
        ? [{ id: 'o1', subtotalPaise: 145_000, discountPaise: 0, cgstPaise: 3_988, sgstPaise: 3_988, serviceTaxPaise: 14_500 }]
        : []
    );
    const kpis: any = await new DashboardService().getKpis('outlet-1', 'biz-1', 'TODAY');
    expect(kpis.taxCollected.value).toBe('₹80'); // ₹79.76 → shown rounded
    expect(kpis.serviceCharge.value).toBe('₹145');
    expect(kpis.totalRevenue.value).toBe('₹1,450');
  });
});
