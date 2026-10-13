import { DashboardService } from '../src/modules/analytics/dashboard.service';
import { prisma } from '../src/config/prisma';
import { outletDateKey, outletStartOfDay } from '../src/utils/outletTime';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    order: { findMany: jest.fn(), groupBy: jest.fn() },
    orderItem: { findMany: jest.fn() },
    wasteLog: { findMany: jest.fn() },
    employee: { count: jest.fn() },
  },
}));

// Helper: an instant from an India-time wall clock on Oct 2026
const ist = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, day, h, m) - 330 * 60 * 1000);
};

type FakeOrder = { id: string; status: string; createdAt: Date; subtotalPaise: number; taxPaise: number; totalPaise: number; discountPaise?: number; cgstPaise?: number; sgstPaise?: number; serviceTaxPaise?: number };

// Brew Bay Bandra — Saturday 10 Oct 2026
const RAW_ORDERS: FakeOrder[] = [
  // Settled lunch & dinner: ₹20,000 food + ₹1,000 GST
  { id: 'o1', status: 'COMPLETED', createdAt: ist(10, '13:00'), subtotalPaise: 1_000_000, taxPaise: 50_000, totalPaise: 1_050_000 },
  { id: 'o2', status: 'COMPLETED', createdAt: ist(10, '20:00'), subtotalPaise: 1_000_000, taxPaise: 50_000, totalPaise: 1_050_000 },
  // Still eating, unpaid
  { id: 'o3', status: 'SERVED', createdAt: ist(10, '22:30'), subtotalPaise: 285_714, taxPaise: 14_286, totalPaise: 300_000 },
  // Cancelled — never counts
  { id: 'o4', status: 'CANCELLED', createdAt: ist(10, '21:00'), subtotalPaise: 500_000, taxPaise: 25_000, totalPaise: 525_000 },
  // Friday (previous period for "today")
  { id: 'o5', status: 'COMPLETED', createdAt: ist(9, '19:00'), subtotalPaise: 1_600_000, taxPaise: 80_000, totalPaise: 1_680_000 },
];

const ORDERS: FakeOrder[] = RAW_ORDERS.map((o) => ({
  discountPaise: 0,
  serviceTaxPaise: 0,
  cgstPaise: o.taxPaise / 2,
  sgstPaise: o.taxPaise / 2,
  ...o,
}));

// Minimal in-memory version of the Prisma filters the dashboard uses
function matches(order: FakeOrder, where: any) {
  if (typeof where.status === 'string' && order.status !== where.status) return false;
  if (where.status?.notIn && where.status.notIn.includes(order.status)) return false;
  if (where.createdAt?.gte && order.createdAt < where.createdAt.gte) return false;
  if (where.createdAt?.lte && order.createdAt > where.createdAt.lte) return false;
  if (where.id?.in && !where.id.in.includes(order.id)) return false;
  return true;
}

describe('Dashboard numbers', () => {
  const service = new DashboardService();
  const SAT_11PM = ist(10, '23:00');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: SAT_11PM, doNotFake: ['nextTick', 'setImmediate'] });
    (prisma.order.findMany as jest.Mock).mockImplementation(({ where }: any) => ORDERS.filter((o) => matches(o, where)));
    (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([]); // no recipes set up
    (prisma.wasteLog.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.employee.count as jest.Mock).mockResolvedValue(5);
  });

  afterEach(() => jest.useRealTimers());

  describe('16a/16b — revenue is settled sales before tax', () => {
    it("counts only settled orders' subtotals, and reports GST and open bills separately", async () => {
      const kpis: any = await service.getKpis('outlet-1', 'biz-1', 'TODAY');

      expect(kpis.totalRevenue.value).toBe('₹20,000'); // not ₹21,000 (GST) or ₹24,000 (+ open bills)
      expect(kpis.taxCollected.value).toBe('₹1,000');
      expect(kpis.openBills).toEqual({ value: '₹3,000', count: 1 });
      expect(kpis.avgOrderValue.value).toBe('₹10,000');
    });

    it('compares with the previous day of the same length (Friday)', async () => {
      const kpis: any = await service.getKpis('outlet-1', 'biz-1', 'TODAY');
      expect(kpis.totalRevenue.prev).toBe('₹16,000');
      expect(kpis.totalRevenue.change).toBe('+25.0%');
    });
  });

  describe('16c — "today" is India time', () => {
    it('at 2 AM Sunday, "today" starts at midnight India time, not at 5:30 AM', async () => {
      jest.setSystemTime(ist(11, '02:00'));
      await service.getKpis('outlet-1', 'biz-1', 'TODAY');
      const firstQuery = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
      expect(firstQuery.where.createdAt.gte).toEqual(ist(11, '00:00'));
    });

    it('"this month" starts at midnight India time on the 1st', async () => {
      await service.getKpis('outlet-1', 'biz-1', 'THIS_MONTH');
      const firstQuery = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
      expect(firstQuery.where.createdAt.gte).toEqual(ist(1, '00:00'));
    });

    it('order numbers use the India-time date', () => {
      // 12:30 AM India time on Sunday 11 Oct is still Saturday in UTC
      expect(outletDateKey(ist(11, '00:30'))).toBe('20261011');
      expect(outletStartOfDay(ist(11, '00:30'))).toEqual(ist(11, '00:00'));
    });
  });

  describe('16d — sales by time of day uses India hours', () => {
    it('puts a 1 PM lunch in "12 PM" and an 8 PM dinner in "8 PM"', async () => {
      const chart: any[] = await service.getSalesVelocity('outlet-1', 'biz-1', 'TODAY');
      const byTime = Object.fromEntries(chart.map((p) => [p.time, p.revenue]));
      expect(byTime['12 PM']).toBe(10_000);
      expect(byTime['8 PM']).toBe(10_000);
      // Trimmed to the trading span (12 PM – 8 PM), not padded with empty night hours
      expect(chart[0].time).toBe('12 PM');
      expect(chart[chart.length - 1].time).toBe('8 PM');
    });
  });

  describe('16e — profit', () => {
    it('does not show a fake margin when no recipe costs are set up', async () => {
      const kpis: any = await service.getKpis('outlet-1', 'biz-1', 'TODAY');
      expect(kpis.cogsConfigured).toBe(false);
      expect(kpis.netMargin.value).toBe('—');
    });

    it('shows a loss instead of ₹0 when costs exceed revenue', async () => {
      // ₹25,000 of waste on Saturday only
      (prisma.wasteLog.findMany as jest.Mock).mockImplementation(({ where }: any) =>
        where.createdAt.gte >= ist(10, '00:00') ? [{ costAtLoggingPaise: 2_500_000 }] : []
      );
      const kpis: any = await service.getKpis('outlet-1', 'biz-1', 'TODAY');
      expect(kpis.grossProfit.value).toBe('-₹5,000');
      expect(kpis.grossProfit.isPositive).toBe(false);
    });

    it('computes a real margin once recipes exist', async () => {
      (prisma.orderItem.findMany as jest.Mock).mockImplementation(({ where }: any) =>
        where.orderId.in.includes('o1')
          ? [{ quantity: 10, menuItem: { recipes: [{ quantityPerUnit: 1, item: { unitCostPaise: 40_000 } }] } }] // ₹4,000 food cost
          : []
      );
      const kpis: any = await service.getKpis('outlet-1', 'biz-1', 'TODAY');
      expect(kpis.cogsConfigured).toBe(true);
      expect(kpis.netMargin.value).toBe('80.0%'); // (20,000 − 4,000) / 20,000
    });
  });

  it('matches nothing (instead of every business) when "all outlets" has no business', async () => {
    await service.getKpis('all', undefined, 'TODAY');
    const firstQuery = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
    expect(firstQuery.where.id).toEqual({ in: [] });
  });
});
