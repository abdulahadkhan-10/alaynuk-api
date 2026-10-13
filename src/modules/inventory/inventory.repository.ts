import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { outletScope } from '../../utils/tenantScope';

export class InventoryRepository {
  /** `targetOutletId` must already be verified as belonging to the caller (see InventoryService.createItem). */
  async createItem(targetOutletId: string, data: any) {
    const { currentStock, outletId: _bodyOutletId, ...itemData } = data;

    return prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          ...itemData,
          outletId: targetOutletId,
        },
      });

      if (currentStock && currentStock > 0) {
        await tx.stockLedgerEntry.create({
          data: {
            outletId: targetOutletId,
            itemId: item.id,
            change: new Prisma.Decimal(currentStock),
            reason: 'ADJUSTMENT',
          },
        });
      }

      return {
        ...item,
        reorderThreshold: item.reorderThreshold.toNumber(),
        currentStock: currentStock || 0,
      };
    });
  }

  async findItemById(outletId: string, id: string, businessId?: string | null) {
    // In "all outlets" mode, only items of the caller's own business
    return prisma.item.findFirst({
      where: { id, deletedAt: null, ...outletScope(outletId, businessId) },
    });
  }

  async findItemBySku(outletId: string, sku: string) {
    const isAll = !outletId || outletId === 'all';
    const where = isAll ? { sku, deletedAt: null } : { sku, outletId, deletedAt: null };
    return prisma.item.findFirst({
      where,
    });
  }

  async getStockBalance(itemId: string): Promise<number> {
    const aggregate = await prisma.stockLedgerEntry.aggregate({
      where: { itemId },
      _sum: {
        change: true,
      },
    });
    return aggregate._sum.change ? aggregate._sum.change.toNumber() : 0;
  }

  async createLedgerEntry(outletId: string, itemId: string, change: number, reason: 'SALE' | 'WASTE' | 'PURCHASE' | 'ADJUSTMENT', referenceId?: string) {
    let targetOutletId = outletId;
    if (!targetOutletId || targetOutletId === 'all') {
      const item = await prisma.item.findUnique({ where: { id: itemId }, select: { outletId: true } });
      if (item) targetOutletId = item.outletId;
    }
    return prisma.stockLedgerEntry.create({
      data: {
        outletId: targetOutletId,
        itemId,
        change: new Prisma.Decimal(change),
        reason,
        referenceId,
      },
    });
  }

  async createRecipe(menuItemId: string, itemId: string, quantityPerUnit: number) {
    return prisma.recipe.upsert({
      where: {
        menuItemId_itemId: {
          menuItemId,
          itemId,
        },
      },
      update: {
        quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
      },
      create: {
        menuItemId,
        itemId,
        quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
      },
    });
  }

  async findRecipesForMenuItem(menuItemId: string) {
    return prisma.recipe.findMany({
      where: { menuItemId },
      include: { item: true },
    });
  }

  async findManyItems(outletId: string, businessId?: string) {
    const isAll = !outletId || outletId === 'all';
    const itemWhere: Prisma.ItemWhereInput = isAll
      ? { deletedAt: null, ...(businessId ? { outlet: { businessId } } : {}) }
      : { outletId, deletedAt: null };

    const ledgerWhere: Prisma.StockLedgerEntryWhereInput = isAll
      ? (businessId ? { outlet: { businessId } } : {})
      : { outletId };

    const items = await prisma.item.findMany({
      where: itemWhere,
      include: { outlet: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const ledgerAggregates = await prisma.stockLedgerEntry.groupBy({
      by: ['itemId'],
      where: ledgerWhere,
      _sum: { change: true },
    });

    const stockMap = new Map<string, number>();
    for (const agg of ledgerAggregates) {
      stockMap.set(agg.itemId, agg._sum.change ? agg._sum.change.toNumber() : 0);
    }

    return items.map((item) => ({
      ...item,
      reorderThreshold: item.reorderThreshold.toNumber(),
      currentStock: stockMap.get(item.id) || 0,
    }));
  }

  async getLowStockAndExpiryAlerts(outletId: string, businessId?: string) {
    const items = await this.findManyItems(outletId, businessId);
    const lowStockItems = items.filter((item) => item.currentStock <= item.reorderThreshold);

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const isAll = !outletId || outletId === 'all';

    const expiringBatches = await prisma.stockBatch.findMany({
      where: {
        ...(isAll
          ? (businessId ? { outlet: { businessId } } : {})
          : { outletId }),
        expiryDate: {
          lte: thirtyDaysFromNow,
        },
      },
      include: {
        item: true,
      },
      orderBy: {
        expiryDate: 'asc',
      },
    });

    return {
      lowStockItems,
      expiringBatches: expiringBatches.map((b) => ({
        ...b,
        quantity: b.quantity.toNumber(),
      })),
    };
  }
}
export default InventoryRepository;

