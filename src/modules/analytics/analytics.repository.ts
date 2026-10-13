import { prisma } from '../../config/prisma';

export class AnalyticsRepository {
  async getDailySummaries(outletId: string, startDate: Date, endDate: Date) {
    return prisma.dailySalesSummary.findMany({
      where: {
        outletId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async getBestWorstSellers(outletId: string) {
    // Aggregate completed order items
    const aggregates = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: {
          outletId,
          status: 'COMPLETED',
        },
      },
      _sum: {
        quantity: true,
      },
    });

    // Load menu item names for the aggregated IDs
    const itemsWithDetails = await Promise.all(
      aggregates.map(async (agg) => {
        const item = await prisma.menuItem.findUnique({
          where: { id: agg.menuItemId },
        });
        return {
          menuItemId: agg.menuItemId,
          name: item ? item.name : 'Unknown Item',
          quantitySold: agg._sum.quantity || 0,
        };
      })
    );

    // Sort to find best and worst
    const sorted = [...itemsWithDetails].sort((a, b) => b.quantitySold - a.quantitySold);
    return {
      bestSellers: sorted.slice(0, 5),
      worstSellers: sorted.slice(-5).reverse(),
    };
  }

  async getOutletComparison(businessId?: string | null, outletIds?: string[]) {
    // Sum completed (settled) orders per outlet — sales before tax, same rule as the dashboard.
    // Always limited to one business (and, for managers, to their assigned outlets).
    const completedOrders = await prisma.order.groupBy({
      by: ['outletId'],
      where: {
        status: 'COMPLETED',
        deletedAt: null,
        ...(businessId ? { outlet: { businessId, deletedAt: null } } : {}),
        ...(outletIds ? { outletId: { in: outletIds } } : {}),
      },
      _sum: {
        subtotalPaise: true,
      },
      _count: {
        id: true,
      },
    });

    const comparison = await Promise.all(
      completedOrders.map(async (item) => {
        const outlet = await prisma.outlet.findUnique({
          where: { id: item.outletId },
        });
        return {
          outletId: item.outletId,
          outletName: outlet ? outlet.name : 'Unknown Outlet',
          totalCompletedOrders: item._count.id,
          totalSalesPaise: item._sum.subtotalPaise || 0,
        };
      })
    );

    return comparison;
  }

  async getReports(outletId: string, startDate: Date, endDate: Date) {
    const dailySummaries = await this.getDailySummaries(outletId, startDate, endDate);

    const totalSales = dailySummaries.reduce((sum, s) => sum + s.grossSalesPaise, 0);
    const totalCOGS = dailySummaries.reduce((sum, s) => sum + s.cogsPaise, 0);
    const totalProfit = dailySummaries.reduce((sum, s) => sum + s.grossProfitPaise, 0);
    const totalOrders = dailySummaries.reduce((sum, s) => sum + s.orderCount, 0);

    return {
      totalSalesPaise: totalSales,
      totalCOGSMinutes: totalCOGS,
      totalProfitPaise: totalProfit,
      totalOrders,
      daysAnalysed: dailySummaries.length,
      summaries: dailySummaries,
    };
  }
}
export default AnalyticsRepository;
