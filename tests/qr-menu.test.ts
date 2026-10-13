import { OrderService } from '../src/modules/orders/order.service';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    tableToken: { findUnique: jest.fn() },
    menuCategory: { findMany: jest.fn() },
  },
}));

const BANDRA = '11111111-1111-1111-1111-111111111111';

describe('QR table menu', () => {
  const service = new OrderService();

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.tableToken.findUnique as jest.Mock).mockResolvedValue({
      token: 'abc-123',
      outletId: BANDRA,
      tableNumber: 5,
      expiresAt: new Date(Date.now() + 60_000),
      outlet: { business: { name: 'Brew Bay' } },
    });
  });

  it('only includes items assigned to and available at the scanned outlet', async () => {
    (prisma.menuCategory.findMany as jest.Mock).mockResolvedValue([]);

    await service.getTableMenu('abc-123');

    const query = (prisma.menuCategory.findMany as jest.Mock).mock.calls[0][0];
    expect(query.include.menuItems.where.outlets).toEqual({
      some: { outletId: BANDRA, isActive: true },
    });
  });

  it('hides categories that have no available items', async () => {
    (prisma.menuCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat-bev', name: 'Beverages', menuItems: [{ id: 'cappuccino' }] },
      { id: 'cat-cold', name: 'Cold Drinks', menuItems: [] }, // everything sold out at Bandra
    ]);

    const result = await service.getTableMenu('abc-123');

    expect(result.businessName).toBe('Brew Bay');
    expect(result.categories.map((c: any) => c.id)).toEqual(['cat-bev']);
  });
});
