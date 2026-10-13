import { prisma } from '../../config/prisma';
import {
  ONE_DAY_MS,
  outletDayStart,
  outletEndOfDay,
  outletLocalParts,
  outletStartOfDateString,
  outletStartOfDay,
} from '../../utils/outletTime';

/*
 * Money rules used everywhere on the dashboard:
 *  - Revenue = SETTLED (COMPLETED) orders only, measured BEFORE taxes (order subtotal).
 *    GST / service charge collected is reported separately — it isn't the outlet's income.
 *  - Orders still open (in the kitchen / unpaid) are reported separately as "open bills".
 *  - All dates and hours are India time (see utils/outletTime), not the server's UTC clock.
 */
const SETTLED = 'COMPLETED' as const;

type ScopeFilter = Record<string, unknown>;

function formatCurrency(paise: number) {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function percentChange(current: number, previous: number) {
  if (previous > 0) {
    const diffPct = ((current - previous) / previous) * 100;
    return { change: `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`, increased: diffPct >= 0 };
  }
  if (current > 0) return { change: '+100.0%', increased: true };
  return { change: '0.0%', increased: true };
}

export class DashboardService {
  /** Which orders/items/waste are in scope: one outlet, or all outlets of the caller's business. */
  private scopeFilter(outletId?: string, businessId?: string): ScopeFilter {
    const isAll = !outletId || outletId === 'all';
    if (!isAll) return { outletId };
    // Never fall back to "every business" when the caller has no business: match nothing instead
    return businessId ? { outlet: { businessId } } : { id: { in: [] } };
  }

  private getDateRangeBounds(range?: string, startDateStr?: string, endDateStr?: string, now: Date = new Date()) {
    const { year, month } = outletLocalParts(now);
    const todayStart = outletStartOfDay(now);
    let startDate: Date;
    let endDate: Date = outletEndOfDay(now);

    if (range === 'TODAY') {
      startDate = todayStart;
    } else if (range === '7_DAY') {
      startDate = new Date(todayStart.getTime() - 7 * ONE_DAY_MS);
    } else if (range === 'CUSTOM' && startDateStr && endDateStr) {
      startDate = outletStartOfDateString(startDateStr);
      endDate = new Date(outletStartOfDateString(endDateStr).getTime() + ONE_DAY_MS - 1);
    } else {
      // THIS_MONTH (default): from the 1st of the current month, India time
      startDate = outletDayStart(year, month, 1);
    }

    return { startDate, endDate };
  }

  /** Food cost of settled orders (from recipes) and whether any recipe costs exist at all. */
  private async foodCost(orderIds: string[]) {
    if (orderIds.length === 0) return { cogsPaise: 0, hasRecipes: false };
    const orderItems = await prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      include: { menuItem: { include: { recipes: { include: { item: true } } } } },
    });

    let cogsPaise = 0;
    let hasRecipes = false;
    for (const orderItem of orderItems) {
      const recipes = orderItem.menuItem.recipes || [];
      if (recipes.length > 0) hasRecipes = true;
      let itemIngredientCostPaise = 0;
      for (const rec of recipes) {
        itemIngredientCostPaise += Math.round(Number(rec.quantityPerUnit) * rec.item.unitCostPaise);
      }
      cogsPaise += itemIngredientCostPaise * orderItem.quantity;
    }
    return { cogsPaise, hasRecipes };
  }

  private async periodFigures(scope: ScopeFilter, startDate: Date, endDate: Date) {
    const settledOrders = await prisma.order.findMany({
      where: { ...scope, status: SETTLED, createdAt: { gte: startDate, lte: endDate }, deletedAt: null },
      select: { id: true, subtotalPaise: true, discountPaise: true, cgstPaise: true, sgstPaise: true, serviceTaxPaise: true },
    });
    // Net food sales (after discount). GST is the government's; service charge is reported separately.
    const revenuePaise = settledOrders.reduce((sum, o) => sum + o.subtotalPaise - o.discountPaise, 0);
    const taxPaise = settledOrders.reduce((sum, o) => sum + o.cgstPaise + o.sgstPaise, 0);
    const serviceChargePaise = settledOrders.reduce((sum, o) => sum + o.serviceTaxPaise, 0);

    const { cogsPaise: foodCostPaise, hasRecipes } = await this.foodCost(settledOrders.map((o) => o.id));
    const waste = await prisma.wasteLog.findMany({
      where: { ...scope, createdAt: { gte: startDate, lte: endDate } },
      select: { costAtLoggingPaise: true },
    });
    const wasteCostPaise = waste.reduce((sum, w) => sum + w.costAtLoggingPaise, 0);

    return {
      orderCount: settledOrders.length,
      revenuePaise,
      taxPaise,
      serviceChargePaise,
      cogsPaise: foodCostPaise + wasteCostPaise,
      hasRecipes,
    };
  }

  async getKpis(outletId?: string, businessId?: string, range?: string, startDateStr?: string, endDateStr?: string) {
    const scope = this.scopeFilter(outletId, businessId);
    const { startDate, endDate } = this.getDateRangeBounds(range, startDateStr, endDateStr);

    // Comparison period of the same length immediately before
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - durationMs - 1);
    const prevEndDate = new Date(startDate.getTime() - 1);

    const current = await this.periodFigures(scope, startDate, endDate);
    const previous = await this.periodFigures(scope, prevStartDate, prevEndDate);

    // Bills placed in this period that are not settled yet (not counted as revenue)
    const openOrders = await prisma.order.findMany({
      where: {
        ...scope,
        status: { notIn: [SETTLED, 'CANCELLED'] },
        createdAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      },
      select: { totalPaise: true },
    });
    const openBillsPaise = openOrders.reduce((sum, o) => sum + o.totalPaise, 0);

    const revenue = percentChange(current.revenuePaise, previous.revenuePaise);
    const cogs = percentChange(current.cogsPaise, previous.cogsPaise);

    // Gross profit can be negative (a loss) — never clamp it to zero
    const grossProfitPaise = current.revenuePaise - current.cogsPaise;
    const previousGrossProfitPaise = previous.revenuePaise - previous.cogsPaise;
    let grossProfitChange = '0.0%';
    let isGrossProfitPositive = grossProfitPaise >= 0;
    if (previousGrossProfitPaise !== 0) {
      const diffPct = ((grossProfitPaise - previousGrossProfitPaise) / Math.abs(previousGrossProfitPaise)) * 100;
      grossProfitChange = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`;
      isGrossProfitPositive = diffPct >= 0;
    }

    // Without recipe costs, "profit" would just be revenue minus waste — say so instead of showing a fake margin
    const cogsConfigured = current.hasRecipes;
    let netMarginVal = '—';
    let marginChange = '';
    let isMarginPositive = true;
    if (cogsConfigured && current.revenuePaise > 0) {
      const marginPct = (grossProfitPaise / current.revenuePaise) * 100;
      netMarginVal = `${marginPct.toFixed(1)}%`;
      isMarginPositive = marginPct >= 0;
      if (previous.hasRecipes && previous.revenuePaise > 0) {
        const prevMarginPct = (previousGrossProfitPaise / previous.revenuePaise) * 100;
        const diffMargin = marginPct - prevMarginPct;
        marginChange = `${diffMargin >= 0 ? '+' : ''}${diffMargin.toFixed(1)}%`;
        isMarginPositive = diffMargin >= 0;
      }
    }

    const avgOrderPaise = current.orderCount > 0 ? Math.round(current.revenuePaise / current.orderCount) : 0;
    const prevAvgOrderPaise = previous.orderCount > 0 ? Math.round(previous.revenuePaise / previous.orderCount) : 0;
    const avgOrder = percentChange(avgOrderPaise, prevAvgOrderPaise);

    // 5. Active staff
    const activeStaffCount = await prisma.employee.count({
      where: { ...scope, status: 'ACTIVE', deletedAt: null },
    });
    const previousStaffCount = await prisma.employee.count({
      where: { ...scope, status: 'ACTIVE', createdAt: { lte: prevEndDate }, deletedAt: null },
    });
    const diffStaff = activeStaffCount - previousStaffCount;

    return {
      totalRevenue: {
        value: formatCurrency(current.revenuePaise),
        prev: formatCurrency(previous.revenuePaise),
        change: revenue.change,
        isPositive: revenue.increased,
      },
      avgOrderValue: {
        value: formatCurrency(avgOrderPaise),
        prev: formatCurrency(prevAvgOrderPaise),
        change: avgOrder.change,
        isPositive: avgOrder.increased,
      },
      // For COGS, a decrease is the good direction
      cogs: { value: formatCurrency(current.cogsPaise), change: cogs.change, isPositive: current.cogsPaise <= previous.cogsPaise },
      grossProfit: { value: formatCurrency(grossProfitPaise), change: grossProfitChange, isPositive: isGrossProfitPositive },
      laborCosts: { value: `${activeStaffCount} Staff`, change: `${diffStaff >= 0 ? '+' : ''}${diffStaff}`, isPositive: diffStaff >= 0 },
      netMargin: { value: netMarginVal, change: marginChange, isPositive: isMarginPositive },
      // Reported separately from revenue
      taxCollected: { value: formatCurrency(current.taxPaise) }, // CGST + SGST only
      serviceCharge: { value: formatCurrency(current.serviceChargePaise) },
      openBills: { value: formatCurrency(openBillsPaise), count: openOrders.length },
      cogsConfigured,
    };
  }

  async getSalesVelocity(outletId?: string, businessId?: string, range?: string, startDateStr?: string, endDateStr?: string) {
    const scope = this.scopeFilter(outletId, businessId);
    const { startDate, endDate } = this.getDateRangeBounds(range, startDateStr, endDateStr);

    const periodOrders = await prisma.order.findMany({
      where: { ...scope, status: SETTLED, createdAt: { gte: startDate, lte: endDate }, deletedAt: null },
      select: { createdAt: true, subtotalPaise: true },
    });

    // 2-hour buckets across the whole day, India time (12 AM, 2 AM, ... 10 PM)
    const labels = Array.from({ length: 12 }, (_, i) => {
      const hour = i * 2;
      const period = hour < 12 ? 'AM' : 'PM';
      const display = hour % 12 === 0 ? 12 : hour % 12;
      return `${display} ${period}`;
    });
    const totals = new Array(12).fill(0);
    for (const order of periodOrders) {
      const { hour } = outletLocalParts(new Date(order.createdAt));
      totals[Math.floor(hour / 2)] += order.subtotalPaise;
    }

    // Show the span the outlet actually trades in; default to 10 AM – 10 PM when there are no sales
    const nonZero = totals.map((t, i) => (t > 0 ? i : -1)).filter((i) => i >= 0);
    const first = nonZero.length > 0 ? Math.min(...nonZero) : 5;
    const last = nonZero.length > 0 ? Math.max(...nonZero) : 11;

    return labels.slice(first, last + 1).map((time, i) => ({
      time,
      revenue: Math.round(totals[first + i] / 100),
    }));
  }

  async getChannelDistribution(outletId?: string, businessId?: string, range?: string, startDateStr?: string, endDateStr?: string) {
    const scope = this.scopeFilter(outletId, businessId);
    const { startDate, endDate } = this.getDateRangeBounds(range, startDateStr, endDateStr);

    const channelCounts = await prisma.order.groupBy({
      by: ['source'],
      where: { ...scope, status: SETTLED, createdAt: { gte: startDate, lte: endDate }, deletedAt: null },
      _count: { id: true },
    });

    const totalOrders = channelCounts.reduce((sum, c) => sum + c._count.id, 0);
    if (totalOrders === 0) return [];

    const sourceLabelMap: Record<string, { name: string; color: string }> = {
      TABLE: { name: "Dine-in", color: "#2563eb" },
      QR: { name: "Dine-in", color: "#2563eb" },
      DELIVERY: { name: "Delivery", color: "#3b82f6" },
      COUNTER: { name: "Takeaway", color: "#d97706" },
    };

    const mergedShares: Record<string, { value: number; color: string }> = {};

    for (const c of channelCounts) {
      const info = sourceLabelMap[c.source] || { name: c.source, color: "#64748b" };
      const pct = Math.round((c._count.id / totalOrders) * 100);
      if (!mergedShares[info.name]) {
        mergedShares[info.name] = { value: pct, color: info.color };
      } else {
        mergedShares[info.name].value += pct;
      }
    }

    return Object.entries(mergedShares).map(([name, data]) => ({
      name,
      value: data.value,
      color: data.color,
    }));
  }

  async getTopSellingItems(outletId?: string, businessId?: string, range?: string, startDateStr?: string, endDateStr?: string) {
    const scope = this.scopeFilter(outletId, businessId);
    const { startDate, endDate } = this.getDateRangeBounds(range, startDateStr, endDateStr);

    const groups = await prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: { ...scope, status: SETTLED, createdAt: { gte: startDate, lte: endDate }, deletedAt: null },
      },
      _sum: { quantity: true, subtotalPaise: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });

    if (groups.length === 0) return [];

    const itemIds = groups.map((g) => g.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, category: { select: { name: true } } },
    });

    const itemMap = new Map(menuItems.map((i) => [i.id, i]));

    return groups.map((g) => {
      const itemInfo = itemMap.get(g.menuItemId);
      return {
        name: itemInfo?.name || 'Item',
        volume: g._sum.quantity || 0,
        revenue: Math.round((g._sum.subtotalPaise || 0) / 100),
        category: itemInfo?.category?.name || 'General',
      };
    });
  }

  async getSalesForecast(outletId?: string, businessId?: string, now: Date = new Date()) {
    const scope = this.scopeFilter(outletId, businessId);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayStart = outletStartOfDay(now);

    // Last 7 India-time days of settled sales (before tax)
    const last7DaysData: { dateLabel: string; actual: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const startOfDay = new Date(todayStart.getTime() - i * ONE_DAY_MS);
      const endOfDay = new Date(startOfDay.getTime() + ONE_DAY_MS - 1);

      const dayOrders = await prisma.order.findMany({
        where: { ...scope, status: SETTLED, createdAt: { gte: startOfDay, lte: endOfDay }, deletedAt: null },
        select: { subtotalPaise: true },
      });

      const revenue = dayOrders.reduce((sum, o) => sum + o.subtotalPaise, 0) / 100; // in Rupees
      last7DaysData.push({
        dateLabel: days[outletLocalParts(startOfDay).weekday],
        actual: Math.round(revenue),
      });
    }

    // Moving average for projection
    const totalActualRevenue = last7DaysData.reduce((sum, item) => sum + item.actual, 0);
    const avgRevenue = last7DaysData.length > 0 ? totalActualRevenue / last7DaysData.length : 0;

    // Generate output array with actual and projected values
    const result = last7DaysData.map(item => ({
      date: item.dateLabel,
      actual: item.actual,
      projected: item.actual > 0 ? Math.round(item.actual * 0.95) : 0,
    }));

    // Add next 3 days projections
    for (let i = 1; i <= 3; i++) {
      const futureDay = new Date(todayStart.getTime() + i * ONE_DAY_MS);
      result.push({
        date: `Next ${days[outletLocalParts(futureDay).weekday]}`,
        actual: 0,
        projected: Math.round(avgRevenue > 0 ? avgRevenue * (1 + (i * 0.02)) : 0),
      });
    }

    return result;
  }

  async getInventoryForecast(outletId?: string, businessId?: string) {
    const scope = this.scopeFilter(outletId, businessId);

    const items = await prisma.item.findMany({
      where: {
        ...scope,
        deletedAt: null,
      },
      include: {
        batches: {
          where: {
            expiryDate: { gte: new Date() }
          }
        }
      },
      take: 10,
    });

    return items.map(item => {
      const currentStock = item.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
      const threshold = Number(item.reorderThreshold);

      // Calculate projected days remaining based on threshold ratios
      let daysRemaining = 0;
      if (currentStock > 0) {
        daysRemaining = threshold > 0 ? (currentStock / threshold) * 5 : 10;
      }

      return {
        item: `${item.name} (${item.unit})`,
        currentStock,
        threshold,
        daysRemaining: parseFloat(daysRemaining.toFixed(1)),
      };
    });
  }
}
