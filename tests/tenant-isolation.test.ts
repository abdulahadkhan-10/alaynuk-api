/**
 * Tenant isolation: one business (Chai Point) must never read or change another business's (Brew Bay) data,
 * through the REST API or the real-time socket channel.
 */
import { authenticateSocket, canAccessOutlet, registerSocketHandlers } from '../src/config/socket';
import { generateToken } from '../src/utils/jwt';
import { OrderRepository } from '../src/modules/orders/order.repository';
import { OrderService } from '../src/modules/orders/order.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { MenuService } from '../src/modules/menu/menu.service';
import { PurchaseOrderService } from '../src/modules/purchase-orders/purchaseOrder.service';
import { AnalyticsRepository } from '../src/modules/analytics/analytics.repository';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    supplier: { findFirst: jest.fn(), updateMany: jest.fn() },
    outlet: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    userOutlet: { findUnique: jest.fn(), findMany: jest.fn() },
    order: { findFirst: jest.fn(), groupBy: jest.fn() },
    item: { findFirst: jest.fn() },
    menuItem: { findFirst: jest.fn() },
    menuCategory: { findFirst: jest.fn() },
    notification: { create: jest.fn() },
  },
}));
jest.mock('../src/config/redis', () => ({ redisClient: { isOpen: false } }));

const BREW_BAY = '11111111-1111-1111-1111-111111111111';
const CHAI_POINT = '22222222-2222-2222-2222-222222222222';
const BREW_BAY_BANDRA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CHAI_POINT_ANDHERI = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const chaiOwner = { userId: 'user-chai-owner', role: 'BUSINESS_OWNER', businessId: CHAI_POINT };

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------------------------
describe('Finding A — real-time socket channel', () => {
  const fakeSocket = (auth: any = {}, cookie?: string) => ({
    id: 'sock-1',
    handshake: { auth, headers: cookie ? { cookie } : {} },
    data: {} as any,
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn(),
  });

  it('refuses a connection without a login', async () => {
    const next = jest.fn();
    await authenticateSocket(fakeSocket({ outletId: BREW_BAY_BANDRA, role: 'BUSINESS_OWNER' }) as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
  });

  it('refuses an invalid token', async () => {
    const next = jest.fn();
    await authenticateSocket(fakeSocket({ token: 'not-a-real-token' }) as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
  });

  it('refuses a deactivated account', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'STAFF', businessId: BREW_BAY, isActive: false, deletedAt: null });
    const next = jest.fn();
    await authenticateSocket(fakeSocket({}, `token=${generateToken({ id: 'u1', role: 'STAFF' })}`) as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
  });

  it('takes identity from the database, ignoring what the browser claims', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-chai-owner', role: 'BUSINESS_OWNER', businessId: CHAI_POINT, isActive: true, deletedAt: null });
    const socket = fakeSocket({
      token: generateToken({ id: 'user-chai-owner', role: 'BUSINESS_OWNER' }),
      businessId: BREW_BAY, // lie
      userId: 'user-brew-owner', // lie
    });
    const next = jest.fn();
    await authenticateSocket(socket as any, next);
    expect(next).toHaveBeenCalledWith();

    registerSocketHandlers(socket as any);
    const rooms = socket.join.mock.calls.map((c: any[]) => c[0]);
    expect(rooms).toContain(`business:${CHAI_POINT}`);
    expect(rooms).not.toContain(`business:${BREW_BAY}`);
    expect(rooms).not.toContain('user:user-brew-owner');
  });

  it("does not let an owner join another business's outlet room", async () => {
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue(null); // Bandra is not in Chai Point's business
    const allowed = await canAccessOutlet({ id: 'user-chai-owner', role: 'BUSINESS_OWNER', businessId: CHAI_POINT }, BREW_BAY_BANDRA);
    expect(allowed).toBe(false);
    expect((prisma.outlet.findFirst as jest.Mock).mock.calls[0][0].where.businessId).toBe(CHAI_POINT);
  });

  it('only lets a manager join outlets they are assigned to', async () => {
    (prisma.outlet.findFirst as jest.Mock).mockResolvedValue({ id: BREW_BAY_BANDRA });
    (prisma.userOutlet.findUnique as jest.Mock).mockResolvedValue(null);
    const allowed = await canAccessOutlet({ id: 'user-mgr', role: 'MANAGER', businessId: BREW_BAY }, BREW_BAY_BANDRA);
    expect(allowed).toBe(false);
  });

  it('ignores requests to join someone else\'s personal / business rooms', async () => {
    const socket = fakeSocket();
    socket.data.user = { id: 'user-chai-owner', role: 'BUSINESS_OWNER', businessId: CHAI_POINT };
    registerSocketHandlers(socket as any);
    socket.join.mockClear();

    const handler = (event: string) => socket.on.mock.calls.find((c: any[]) => c[0] === event)[1];
    handler('join_user')('user-brew-owner');
    handler('join_business')(BREW_BAY);
    handler('join_role')({ role: 'BUSINESS_OWNER', businessId: BREW_BAY });
    expect(socket.join).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe('17a — Performance page branch comparison', () => {
  it("only includes the caller's own business", async () => {
    (prisma.order.groupBy as jest.Mock).mockResolvedValue([]);
    await new AnalyticsRepository().getOutletComparison(CHAI_POINT);
    expect((prisma.order.groupBy as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: CHAI_POINT, deletedAt: null });
  });

  it('returns nothing for an account without a business', async () => {
    expect(await new AnalyticsService().getOutletComparison({ businessId: null })).toEqual([]);
    expect(prisma.order.groupBy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe('17b — menu', () => {
  it("cannot change the price of another business's menu item", async () => {
    (prisma.menuItem.findFirst as jest.Mock).mockResolvedValue(null); // not found within Chai Point's scope
    await expect(
      new MenuService().updateMenuItem('all', 'brew-bay-cold-coffee', { price: 1 }, chaiOwner)
    ).rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND' });

    const where = (prisma.menuItem.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain(CHAI_POINT);
  });

  it("cannot delete another business's menu item", async () => {
    (prisma.menuItem.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new MenuService().deleteMenuItem(CHAI_POINT_ANDHERI, 'brew-bay-cappuccino', CHAI_POINT)).rejects.toMatchObject({
      code: 'MENU_ITEM_NOT_FOUND',
    });
  });

  it("cannot rename or delete another business's category", async () => {
    (prisma.menuCategory.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new MenuService().deleteCategory('brew-bay-beverages', 'all', CHAI_POINT)).rejects.toThrow('Category not found');
    expect((prisma.menuCategory.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: CHAI_POINT });
  });
});

// ---------------------------------------------------------------------------------------------
describe('17c — "all outlets" lookups by ID stay inside the business', () => {
  it('orders', async () => {
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);
    await new OrderRepository().findOrderById('all', 'brew-bay-order', CHAI_POINT);
    expect((prisma.order.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: CHAI_POINT });
  });

  it('orders: matches nothing when there is no business', async () => {
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);
    await new OrderRepository().findOrderById('all', 'brew-bay-order', undefined);
    expect((prisma.order.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({
      businessId: '00000000-0000-0000-0000-000000000000',
    });
  });

  it("stock adjustments can't reach another business's item", async () => {
    (prisma.item.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      new InventoryService().adjustStock('all', 'brew-bay-milk', -10, 'ADJUSTMENT', undefined, 'user-chai-owner', CHAI_POINT)
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect((prisma.item.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: CHAI_POINT });
  });

  it('placing an order requires a specific branch', async () => {
    await expect(
      new OrderService().createOrder('all', { items: [{ menuItemId: 'x', quantity: 1 }] })
    ).rejects.toMatchObject({ code: 'OUTLET_REQUIRED' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('17d — creating stock never lands in someone else\'s branch', () => {
  it('requires a branch in "all outlets" mode instead of picking the first one in the database', async () => {
    await expect(new InventoryService().createItem('all', { name: 'Milk', sku: 'MILK' }, chaiOwner)).rejects.toMatchObject({
      code: 'OUTLET_REQUIRED',
    });
  });

  it("rejects adding an item to another business's branch", async () => {
    (prisma.outlet.findMany as jest.Mock).mockResolvedValue([]); // Bandra is not Chai Point's
    await expect(
      new InventoryService().createItem('all', { name: 'Milk', sku: 'MILK', outletId: BREW_BAY_BANDRA }, chaiOwner)
    ).rejects.toThrow('do not belong to your business');
  });

  it('purchase orders only accept stock items of the receiving branch', async () => {
    (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 'sup-1', outletId: CHAI_POINT_ANDHERI });
    (prisma.item.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      new PurchaseOrderService().createPO(CHAI_POINT_ANDHERI, 'sup-1', [{ itemId: 'brew-bay-milk', orderedQuantity: 1, unitCostPaise: 100 }], CHAI_POINT)
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect((prisma.item.findFirst as jest.Mock).mock.calls[0][0].where.outletId).toBe(CHAI_POINT_ANDHERI);
  });
});

// ---------------------------------------------------------------------------------------------
describe('17e — suppliers', () => {
  it("cannot edit another business's supplier", async () => {
    (prisma.supplier.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(new PurchaseOrderService().updateSupplier('all', 'brew-bay-dairy', { name: 'x' }, CHAI_POINT)).rejects.toMatchObject({
      code: 'SUPPLIER_NOT_FOUND',
    });
    expect((prisma.supplier.findFirst as jest.Mock).mock.calls[0][0].where.outlet).toEqual({ businessId: CHAI_POINT });
  });

  it('cannot move a supplier to another outlet or login account through an edit', async () => {
    (prisma.supplier.findFirst as jest.Mock).mockResolvedValue({ id: 'sup-1' });
    await new PurchaseOrderService().updateSupplier(CHAI_POINT_ANDHERI, 'sup-1', { name: 'Amul', outletId: BREW_BAY_BANDRA, userId: 'someone' }, CHAI_POINT);
    expect((prisma.supplier.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({ name: 'Amul' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('Notifications', () => {
  it('tags outlet notifications with their business and never uses the platform-wide role room', async () => {
    (prisma.outlet.findUnique as jest.Mock).mockResolvedValue({ businessId: BREW_BAY });
    (prisma.notification.create as jest.Mock).mockImplementation(({ data }: any) => data);
    const saved: any = await NotificationService.createAndEmit({
      outletId: BREW_BAY_BANDRA,
      role: 'MANAGER' as any,
      title: 't',
      message: 'm',
      type: 'X',
    });
    expect(saved.businessId).toBe(BREW_BAY);
  });
});
