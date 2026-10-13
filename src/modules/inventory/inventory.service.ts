import { InventoryRepository } from './inventory.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { EmployeeActor, assertOutletsAccessible } from '../employees/employee.permissions';
import { isAllOutlets, menuItemScope } from '../../utils/tenantScope';

export class InventoryService {
  private inventoryRepository = new InventoryRepository();

  async createItem(outletId: string, data: any, actor: EmployeeActor) {
    // A stock item always belongs to one specific outlet of the caller — never "some outlet in the database"
    const targetOutletId: string | undefined = data.outletId || (isAllOutlets(outletId) ? undefined : outletId);
    if (!targetOutletId || isAllOutlets(targetOutletId)) {
      throw new AppError('OUTLET_REQUIRED', 'Please choose the branch this item belongs to.', 400);
    }
    await assertOutletsAccessible(actor, [targetOutletId]);

    const existing = await this.inventoryRepository.findItemBySku(targetOutletId, data.sku);
    if (existing) {
      throw new AppError('SKU_ALREADY_EXISTS', 'An item with this SKU already exists', 400);
    }
    return this.inventoryRepository.createItem(targetOutletId, data);
  }

  async getItemStock(outletId: string, itemId: string, businessId?: string | null) {
    const item = await this.inventoryRepository.findItemById(outletId, itemId, businessId);
    if (!item) {
      throw new AppError('ITEM_NOT_FOUND', 'Inventory item not found', 404);
    }
    const balance = await this.inventoryRepository.getStockBalance(itemId);
    return {
      itemId,
      name: item.name,
      sku: item.sku,
      currentStock: balance,
      unit: item.unit,
    };
  }

  async adjustStock(
    outletId: string,
    itemId: string,
    change: number,
    reason: 'SALE' | 'WASTE' | 'PURCHASE' | 'ADJUSTMENT',
    referenceId?: string,
    loggedById?: string,
    businessId?: string | null
  ) {
    const item = await this.inventoryRepository.findItemById(outletId, itemId, businessId);
    if (!item) {
      throw new AppError('ITEM_NOT_FOUND', 'Inventory item not found', 404);
    }

    // Business of the item's own outlet (for notifications)
    const targetOutlet = await prisma.outlet.findUnique({
      where: { id: item.outletId },
      select: { businessId: true },
    });
    const itemBusinessId = targetOutlet?.businessId;

    // If change is negative (deduction), check current stock
    if (change < 0) {
      const currentStock = await this.inventoryRepository.getStockBalance(itemId);
      if (currentStock + change < 0) {
        throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock for ${item.name}. Current: ${currentStock}, Requested deduction: ${Math.abs(change)}`, 400);
      }
    }

    let result: any;

    if (reason === 'WASTE' && change < 0) {
      const wasteQty = Math.abs(change);
      const costAtLoggingPaise = Math.round(wasteQty * item.unitCostPaise);
      
      let userId = loggedById;
      if (!userId) {
        const fallbackUser = await prisma.user.findFirst();
        userId = fallbackUser?.id || "00000000-0000-0000-0000-000000000000";
      }

      result = await prisma.$transaction(async (tx) => {
        const wasteLog = await tx.wasteLog.create({
          data: {
            itemId,
            quantity: new Prisma.Decimal(wasteQty),
            costAtLoggingPaise,
            reason: 'SPOILAGE',
            outletId: item.outletId,
            loggedById: userId,
          },
        });

        NotificationService.notifyHighWasteLogged({
          id: wasteLog.id,
          itemName: item.name,
          quantity: wasteQty,
          costPaise: costAtLoggingPaise,
          outletId: item.outletId,
          businessId: itemBusinessId,
        }).catch(() => {});

        return tx.stockLedgerEntry.create({
          data: {
            outletId: item.outletId,
            itemId,
            change: new Prisma.Decimal(change),
            reason: 'WASTE',
            referenceId: wasteLog.id,
          },
        });
      });
    } else {
      // Ledger entry always goes to the item's own outlet
      result = await this.inventoryRepository.createLedgerEntry(item.outletId, itemId, change, reason, referenceId);
    }

    // Check post-adjustment stock balance for low stock alert
    const newStock = await this.inventoryRepository.getStockBalance(itemId);
    const threshold = item.reorderThreshold.toNumber();
    if (newStock <= threshold) {
      NotificationService.notifyStockAlert({
        id: itemId,
        itemName: item.name,
        type: 'LOW_STOCK',
        message: `Low stock alert for ${item.name}! Current stock is ${newStock} ${item.unit} (Threshold: ${threshold} ${item.unit}).`,
        outletId: item.outletId,
        businessId: itemBusinessId,
      }).catch(() => {});
    }

    return result;
  }


  async createRecipe(
    outletId: string,
    data: { menuItemId: string; itemId: string; quantityPerUnit: number },
    businessId?: string | null
  ) {
    // Both the stock item and the menu item must belong to the caller's outlet / business
    const item = await this.inventoryRepository.findItemById(outletId, data.itemId, businessId);
    if (!item) {
      throw new AppError('ITEM_NOT_FOUND', 'Inventory item not found', 404);
    }
    await this.assertMenuItemInScope(outletId, data.menuItemId, businessId);

    return this.inventoryRepository.createRecipe(data.menuItemId, data.itemId, data.quantityPerUnit);
  }

  private async assertMenuItemInScope(outletId: string, menuItemId: string, businessId?: string | null) {
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: menuItemId, deletedAt: null, ...menuItemScope(outletId, businessId) },
      select: { id: true },
    });
    if (!menuItem) {
      throw new AppError('MENU_ITEM_NOT_FOUND', 'Menu item not found', 404);
    }
  }

  async calculateMenuItemCost(outletId: string, menuItemId: string, businessId?: string | null) {
    await this.assertMenuItemInScope(outletId, menuItemId, businessId);
    const recipes = await this.inventoryRepository.findRecipesForMenuItem(menuItemId);
    if (recipes.length === 0) {
      return {
        menuItemId,
        totalCostPaise: 0,
        breakdown: [],
      };
    }

    let totalCost = 0;
    const breakdown = recipes.map((r) => {
      const qty = r.quantityPerUnit.toNumber();
      const costPerUnit = r.item.unitCostPaise;
      const subtotal = Math.round(qty * costPerUnit);
      totalCost += subtotal;

      return {
        itemId: r.itemId,
        itemName: r.item.name,
        quantityUsed: qty,
        unit: r.item.unit,
        unitCostPaise: costPerUnit,
        costContributionPaise: subtotal,
      };
    });

    return {
      menuItemId,
      totalCostPaise: totalCost,
      breakdown,
    };
  }

  async getAllItems(outletId: string, businessId?: string) {
    const items = await this.inventoryRepository.findManyItems(outletId, businessId);
    return { items, total: items.length };
  }

  async getAlerts(outletId: string, businessId?: string) {
    return this.inventoryRepository.getLowStockAndExpiryAlerts(outletId, businessId);
  }
}
export default InventoryService;

