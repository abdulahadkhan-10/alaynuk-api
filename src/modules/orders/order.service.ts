import { OrderRepository } from './order.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';
import { outletDateKey, outletStartOfDay } from '../../utils/outletTime';
import { outletScope } from '../../utils/tenantScope';
import { BillRates, BillTotals, calculateBill, isDineIn } from './billing';

type DecimalLike = { toNumber: () => number } | number | null | undefined;
const toRate = (value: DecimalLike, fallback = 0) =>
  value === null || value === undefined ? fallback : typeof value === 'number' ? value : value.toNumber();

/** The outlet's currently configured rates (service charge % is stored in the historical serviceTaxRateDecimal column). */
function outletBillRates(outlet: { cgstRateDecimal: DecimalLike; sgstRateDecimal: DecimalLike; serviceTaxRateDecimal?: DecimalLike }): BillRates {
  return {
    cgstRate: toRate(outlet.cgstRateDecimal),
    sgstRate: toRate(outlet.sgstRateDecimal),
    serviceChargeRate: toRate(outlet.serviceTaxRateDecimal),
  };
}

/** Bill amounts + the configured rate snapshot, in Order column names. */
function billToOrderFields(bill: BillTotals, rates: BillRates) {
  return {
    subtotalPaise: bill.subtotalPaise,
    discountPaise: bill.discountPaise,
    serviceTaxPaise: bill.serviceChargePaise,
    cgstPaise: bill.cgstPaise,
    sgstPaise: bill.sgstPaise,
    taxPaise: bill.cgstPaise + bill.sgstPaise + bill.serviceChargePaise,
    roundOffPaise: bill.roundOffPaise,
    totalPaise: bill.totalPaise,
    cgstRate: new Prisma.Decimal(rates.cgstRate),
    sgstRate: new Prisma.Decimal(rates.sgstRate),
    serviceChargeRate: new Prisma.Decimal(rates.serviceChargeRate),
  };
}

const ORDER_INCLUDE = {
  items: { include: { menuItem: true } },
  statusHistory: true,
  payments: true,
  outlet: true,
} as const;

export class OrderService {
  private orderRepository = new OrderRepository();

  /**
   * Recalculate a bill from ALL its items using the rates snapshotted on the order (so a settings change
   * mid-service never splits a bill). Called after every change to the bill and once more at settlement.
   */
  async recalculateOrder(orderId: string, tx: Prisma.TransactionClient = prisma) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, outlet: true },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
    }

    // Older bills created before rate snapshots existed take the outlet's current rates once
    const configured = outletBillRates(order.outlet);
    const rates: BillRates = {
      cgstRate: toRate(order.cgstRate, configured.cgstRate),
      sgstRate: toRate(order.sgstRate, configured.sgstRate),
      serviceChargeRate: toRate(order.serviceChargeRate, configured.serviceChargeRate),
    };

    const billableItems = order.items.filter((item) => item.status !== 'CANCELLED');
    const bill = calculateBill(billableItems, rates, {
      dineIn: isDineIn(order.source),
      serviceChargeWaived: order.serviceChargeWaived,
      discountPaise: order.discountPaise,
      gstRegistrationType: order.outlet.gstRegistrationType,
    });

    return tx.order.update({
      where: { id: orderId },
      data: billToOrderFields(bill, rates),
      include: ORDER_INCLUDE,
    });
  }

  /**
   * Remove (or restore) the service charge on an open dine-in bill. Service charge is voluntary in India
   * (CCPA guidelines, upheld by the Delhi High Court in 2025): the customer may ask for it to be removed.
   */
  async setServiceChargeWaiver(
    outletId: string,
    orderId: string,
    waive: boolean,
    reason: string | undefined,
    changedById: string,
    businessId?: string | null
  ) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null, ...outletScope(outletId, businessId) },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
    }
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new AppError('BILL_CLOSED', 'This bill is already closed and can no longer be changed.', 400);
    }
    if (!isDineIn(order.source)) {
      throw new AppError('NOT_DINE_IN', 'Service charge only applies to dine-in orders.', 400);
    }
    const trimmedReason = reason?.trim();
    if (waive && !trimmedReason) {
      throw new AppError('VALIDATION_ERROR', 'Please give a reason for removing the service charge.', 400);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        serviceChargeWaived: waive,
        serviceChargeWaivedById: waive ? changedById : null,
        serviceChargeWaiveReason: waive ? trimmedReason : null,
        statusHistory: {
          create: {
            status: order.status,
            changedById,
            comment: waive ? `Service charge removed: ${trimmedReason}` : 'Service charge restored',
          },
        },
      },
    });

    return this.transformOrder(await this.recalculateOrder(orderId));
  }

  private async generateCustomOrderId(outletId: string): Promise<string> {
    // Only ever called with the specific outlet the order belongs to (validated in createOrder)
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      include: { business: true },
    });

    const restaurantName = outlet?.name || outlet?.business?.name || 'ALAYN';
    const prefix = restaurantName.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');

    // Date and daily sequence use India time, so numbering restarts at local midnight (not 5:30 AM)
    const now = new Date();
    const dateKey = outletDateKey(now);

    // Count today's orders for this outlet to generate atomic sequential number
    const todayStart = outletStartOfDay(now);
    const countToday = await prisma.order.count({
      where: {
        outletId,
        createdAt: { gte: todayStart },
      },
    });

    let seqNum = countToday + 1;
    let candidate = `${prefix}${dateKey}${String(seqNum).padStart(4, '0')}`;

    // Increment sequentially if there is a collision to guarantee clean, elegant order IDs
    while (true) {
      const existing = await prisma.order.findFirst({
        where: { orderNumber: candidate },
        select: { id: true },
      });
      if (!existing) {
        break;
      }
      seqNum++;
      candidate = `${prefix}${dateKey}${String(seqNum).padStart(4, '0')}`;
    }

    return candidate;
  }


  async createOrder(
    outletId: string,
    data: { tableNumber?: number | string; tableNo?: number | string; source?: 'TABLE' | 'COUNTER' | 'QR' | 'DELIVERY'; orderSource?: 'TABLE' | 'COUNTER' | 'QR' | 'DELIVERY'; tableToken?: string; items: { menuItemId: string; quantity: number; notes?: string }[] },
    user?: { id?: string; name?: string; role?: string }
  ) {
    const isUuid = (id: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
    // An order always belongs to one specific outlet — never fall back to "some outlet in the database"
    if (!isUuid(outletId)) {
      throw new AppError('OUTLET_REQUIRED', 'Please select a specific branch before placing an order.', 400);
    }
    // 1. Fetch Outlet tax rates
    const outlet = await prisma.outlet.findFirst({
      where: { id: outletId, deletedAt: null },
    });
    if (!outlet) {
      throw new AppError('OUTLET_NOT_FOUND', 'Outlet not found', 404);
    }

    const resolvedSource = data.source || data.orderSource || 'COUNTER';
    const rawTable = data.tableNumber ?? data.tableNo;
    let resolvedTableNumber = typeof rawTable === 'number' ? rawTable : (typeof rawTable === 'string' ? parseInt(rawTable, 10) || undefined : undefined);

    if (resolvedSource === 'TABLE' && !resolvedTableNumber) {
      throw new AppError('TABLE_NUMBER_REQUIRED', 'Please select a table number for table orders', 400);
    }

    // Validate QR ordering TableToken if provided
    if (data.source === 'QR' && data.tableToken) {
      const tokenRecord = await prisma.tableToken.findUnique({
        where: { token: data.tableToken },
      });

      if (!tokenRecord) {
        throw new AppError('INVALID_TOKEN', 'Table token is invalid', 400);
      }

      if (new Date() > tokenRecord.expiresAt) {
        throw new AppError('EXPIRED_TOKEN', 'Table token has expired', 400);
      }

      if (tokenRecord.outletId !== outletId) {
        throw new AppError('FORBIDDEN', 'Table token belongs to a different outlet', 403);
      }

      resolvedTableNumber = tokenRecord.tableNumber;
    }

    // 2. Fetch all menu items to price the incoming items
    const itemDetails: { menuItemId: string; quantity: number; unitPricePaise: number; subtotalPaise: number; notes?: string }[] = [];

    for (const item of data.items) {
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: item.menuItemId, deletedAt: null },
        include: {
          outlets: {
            where: { outletId }
          }
        }
      });
      if (!menuItem || menuItem.outlets.length === 0) {
        throw new AppError('MENU_ITEM_NOT_FOUND', `Menu item ${item.menuItemId} not found or not assigned to this outlet`, 404);
      }
      const isItemActive = menuItem.isActive && menuItem.outlets[0].isActive;
      if (!isItemActive) {
        throw new AppError('MENU_ITEM_INACTIVE', `Menu item ${menuItem.name} is inactive`, 400);
      }

      itemDetails.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPricePaise: menuItem.pricePaise,
        subtotalPaise: menuItem.pricePaise * item.quantity,
        notes: item.notes,
      });
    }

    // Check if an active order exists for this table
    if (resolvedTableNumber) {
      const activeOrder = await prisma.order.findFirst({
        where: {
          outletId,
          tableNumber: resolvedTableNumber,
          status: {
            notIn: ['COMPLETED', 'CANCELLED'],
          },
          deletedAt: null,
        },
      });

      if (activeOrder) {
        // New round (KOT) on the table's running bill: add the items, then recalculate the WHOLE bill
        await this.orderRepository.appendItemsToOrder(activeOrder.id, itemDetails);
        const appended = await this.recalculateOrder(activeOrder.id);
        await prisma.table.updateMany({
          where: { outletId, tableNumber: resolvedTableNumber },
          data: { status: 'OCCUPIED' },
        });
        return this.transformOrder(appended);
      }
    }

    // 3. Price the new bill with the outlet's current rates (snapshotted on the order)
    const rates = outletBillRates(outlet);
    const bill = calculateBill(itemDetails, rates, {
      dineIn: isDineIn(resolvedSource),
      gstRegistrationType: outlet.gstRegistrationType,
    });

    // Generate custom order number (e.g. ALA2026072200001) for new order
    const orderNumber = await this.generateCustomOrderId(outletId);

    const placedByName = user?.name || (resolvedSource === 'QR' ? 'Customer (QR)' : 'Staff');
    const placedByRole = user?.role || (resolvedSource === 'QR' ? 'QR' : 'STAFF');

    const createdOrder = await this.orderRepository.createOrder(outletId, {
      orderNumber,
      tableNumber: resolvedTableNumber,
      source: resolvedSource,
      status: 'SENT_TO_KITCHEN',
      ...billToOrderFields(bill, rates),
      placedByName,
      placedByRole,
      customerName: (data as any).customerName,
      customerPhone: (data as any).customerPhone,
      items: itemDetails,
    });

    if (resolvedTableNumber) {
      await prisma.table.updateMany({
        where: { outletId, tableNumber: resolvedTableNumber },
        data: { status: 'OCCUPIED' },
      });
    }

    // Trigger real-time notifications to Kitchen, Manager, and Staff
    NotificationService.notifyOrderPlaced({
      id: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      totalPaise: createdOrder.totalPaise,
      outletId: createdOrder.outletId,
      businessId: outlet.businessId,
    }).catch(() => { });

    return this.transformOrder(createdOrder);
  }

  public transformOrder(order: any) {
    if (!order) return order;
    const formattedOrderNo = order.orderNumber || `#${order.id.slice(0, 8).toUpperCase()}`;
    return {
      ...order,
      branchName: order.outlet?.name || order.outletId,
      orderNo: formattedOrderNo,
      orderNumber: formattedOrderNo,
      orderSource: order.source,
      tableNo: order.tableNumber !== null && order.tableNumber !== undefined ? String(order.tableNumber) : undefined,
      subtotal: (order.subtotalPaise || 0) / 100,
      taxAmount: (order.taxPaise || 0) / 100,
      cgstAmount: (order.cgstPaise || 0) / 100,
      sgstAmount: (order.sgstPaise || 0) / 100,
      serviceTaxAmount: (order.serviceTaxPaise || 0) / 100, // kept for older screens
      serviceChargeAmount: (order.serviceTaxPaise || 0) / 100,
      discountAmount: (order.discountPaise || 0) / 100,
      roundOffAmount: (order.roundOffPaise || 0) / 100,
      totalAmount: (order.totalPaise || 0) / 100,
      // Rates used on THIS bill (null on bills created before snapshots existed)
      cgstRate: order.cgstRate !== null && order.cgstRate !== undefined ? Number(order.cgstRate) : null,
      sgstRate: order.sgstRate !== null && order.sgstRate !== undefined ? Number(order.sgstRate) : null,
      serviceChargeRate:
        order.serviceChargeRate !== null && order.serviceChargeRate !== undefined ? Number(order.serviceChargeRate) : null,
      serviceChargeWaived: !!order.serviceChargeWaived,
      serviceChargeWaiveReason: order.serviceChargeWaiveReason || null,
      isDineIn: isDineIn(order.source),
      gstRegistrationType: order.outlet?.gstRegistrationType || 'REGULAR',
      placedByName: order.placedByName || (order.source === 'QR' ? 'Customer (QR)' : 'Staff'),
      placedByRole: order.placedByRole || (order.source === 'QR' ? 'QR' : 'STAFF'),
      paymentMethod: order.payments?.[0]?.method || undefined,
      paymentStatus: order.payments?.[0]?.status || 'PENDING',
      orderItems: (order.items || []).map((item: any) => ({
        ...item,
        unitPrice: (item.unitPricePaise || 0) / 100,
        subtotal: (item.subtotalPaise || 0) / 100,
      })),
    };
  }

  async getOrders(
    outletId: string,
    status?: string,
    filters?: {
      excludeCompleted?: boolean;
      startDate?: string;
      endDate?: string;
      placedByName?: string;
      source?: string;
      paymentMethod?: string;
      businessId?: string;
    }
  ) {
    const orders = await this.orderRepository.findOrders(outletId, status, filters);
    return orders.map((o) => this.transformOrder(o));
  }

  async getKitchenOrders(outletId: string, businessId?: string) {
    const orders = await this.orderRepository.findKitchenOrders(outletId, businessId);
    return orders.map((o) => this.transformOrder(o));
  }

  async createPayment(
    outletId: string,
    orderId: string,
    data: { amountPaise: number; method: 'UPI' | 'CARD' | 'CASH'; status: 'PENDING' | 'CONFIRMED' | 'FAILED' },
    businessId?: string | null
  ) {
    const order = await this.orderRepository.findOrderById(outletId, orderId, businessId);
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
    }
    if (order.status === 'CANCELLED') {
      throw new AppError('INVALID_STATE_TRANSITION', 'Cannot record payment for a cancelled order', 400);
    }
    return this.orderRepository.createPayment(orderId, data.amountPaise, data.method, data.status);
  }

  async updateOrderStatus(
    outletId: string,
    orderId: string,
    status: 'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' | 'SERVED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED',
    comment?: string,
    changedById?: string,
    paymentMethod?: 'CASH' | 'CARD' | 'UPI',
    customerName?: string,
    customerPhone?: string,
    businessId?: string | null,
    userRole?: string
  ) {
    const order = await this.orderRepository.findOrderById(outletId, orderId, businessId);
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
    }

    // Basic state transitions checks
    const current = order.status;
    if (current === 'COMPLETED' || current === 'CANCELLED') {
      throw new AppError('INVALID_STATE_TRANSITION', `Cannot change status of a ${current} order`, 400);
    }

    if (status === 'CANCELLED') {
      // 1. Anti-fraud check: Only a Manager or Business Owner is authorized to void / cancel an order
      if (userRole && !['BUSINESS_OWNER', 'MANAGER', 'SUPER_ADMIN'].includes(userRole)) {
        throw new AppError(
          'FORBIDDEN',
          'Only a Manager or Business Owner is authorized to cancel an order.',
          403
        );
      }

      // 2. Anti-fraud check: Prevent cancelling an order that already has recorded confirmed payments
      const hasConfirmedPayments = order.payments?.some((p) => p.status === 'CONFIRMED');
      if (hasConfirmedPayments) {
        throw new AppError(
          'ORDER_ALREADY_PAID',
          'This order has recorded payments and cannot be cancelled directly.',
          400
        );
      }
    }

    if (status === 'COMPLETED') {
      // 0. Final bill calculation — after settlement the bill is frozen
      const finalBill = await this.recalculateOrder(orderId);

      // 1. Check payment balance, auto-record payment if needed
      let confirmedPaymentsSum = order.payments
        .filter((p) => p.status === 'CONFIRMED')
        .reduce((sum, p) => sum + p.amountPaise, 0);

      if (confirmedPaymentsSum < finalBill.totalPaise) {
        const remainingPaise = finalBill.totalPaise - confirmedPaymentsSum;
        let method: 'CASH' | 'CARD' | 'UPI' = paymentMethod || 'CASH';
        if (!paymentMethod && comment) {
          const methodCandidate = comment.toUpperCase();
          if (methodCandidate.includes('CARD')) method = 'CARD';
          else if (methodCandidate.includes('UPI')) method = 'UPI';
        }

        await this.orderRepository.createPayment(orderId, remainingPaise, method, 'CONFIRMED');
        confirmedPaymentsSum = finalBill.totalPaise;
      }

      // 2. Perform Order stock deduction & status change in a single transaction
      return prisma.$transaction(async (tx) => {
        // Collect all ingredient requirements
        const ingredientRequirements: { [itemId: string]: { name: string; quantity: number } } = {};

        for (const orderItem of order.items) {
          const recipes = await tx.recipe.findMany({
            where: { menuItemId: orderItem.menuItemId },
            include: { item: true },
          });

          for (const recipe of recipes) {
            const qtyNeeded = recipe.quantityPerUnit.toNumber() * orderItem.quantity;
            if (ingredientRequirements[recipe.itemId]) {
              ingredientRequirements[recipe.itemId].quantity += qtyNeeded;
            } else {
              ingredientRequirements[recipe.itemId] = {
                name: recipe.item.name,
                quantity: qtyNeeded,
              };
            }
          }
        }

        // Validate stock for each ingredient
        for (const itemId of Object.keys(ingredientRequirements)) {
          const req = ingredientRequirements[itemId];

          const ledgerSum = await tx.stockLedgerEntry.aggregate({
            where: { itemId },
            _sum: {
              change: true,
            },
          });

          const currentStock = ledgerSum._sum.change ? ledgerSum._sum.change.toNumber() : 0;
          if (currentStock < req.quantity) {
            throw new AppError(
              'INSUFFICIENT_STOCK',
              `Insufficient stock for ingredient: ${req.name}. Current: ${currentStock}, Required: ${req.quantity}`,
              400
            );
          }
        }

        // Deduct stock by writing negative SALE ledger entries for the order's specific outlet
        const targetOutletId = (order.outletId && order.outletId !== 'all') ? order.outletId : outletId;
        for (const itemId of Object.keys(ingredientRequirements)) {
          const req = ingredientRequirements[itemId];
          await tx.stockLedgerEntry.create({
            data: {
              outletId: targetOutletId,
              itemId,
              change: new Prisma.Decimal(-req.quantity),
              reason: 'SALE',
              referenceId: orderId,
            },
          });
        }

        // Update Order to COMPLETED
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'COMPLETED',
            ...(customerName ? { customerName } : {}),
            ...(customerPhone ? { customerPhone } : {}),
          },
          include: { items: true, statusHistory: true, outlet: true, payments: true },
        });

        // Release Table back to AVAILABLE
        if (order.tableNumber !== null && order.tableNumber !== undefined) {
          const targetOutletId = order.outletId || outletId;
          if (targetOutletId && targetOutletId !== 'all') {
            await tx.table.updateMany({
              where: { outletId: targetOutletId, tableNumber: order.tableNumber },
              data: { status: 'AVAILABLE' },
            });
          }
        }

        // Add history entry
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            status: 'COMPLETED',
            changedById,
            comment: comment || 'Order completed, payment settled, and table freed',
          },
        });

        return this.transformOrder(updatedOrder);
      });
    }

    // Free table if order is cancelled
    if (status === 'CANCELLED' && order.tableNumber !== null && order.tableNumber !== undefined) {
      const targetOutletId = order.outletId || outletId;
      if (targetOutletId && targetOutletId !== 'all') {
        await prisma.table.updateMany({
          where: { outletId: targetOutletId, tableNumber: order.tableNumber },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    // Normal status transition (not COMPLETED)
    if (status === 'PREPARING') {
      await (prisma.orderItem as any).updateMany({
        where: { orderId, status: 'SENT_TO_KITCHEN' },
        data: { status: 'PREPARING' },
      });
    } else if (status === 'READY') {
      await (prisma.orderItem as any).updateMany({
        where: { orderId, status: 'PREPARING' },
        data: { status: 'READY' },
      });
    } else if (status === 'SERVED') {
      await (prisma.orderItem as any).updateMany({
        where: { orderId, status: 'READY' },
        data: { status: 'SERVED' },
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: status as any,
        ...(customerName ? { customerName } : {}),
        ...(customerPhone ? { customerPhone } : {}),
      },
    });

    await this.orderRepository.addStatusHistory(orderId, status, changedById, comment);

    const updated = await this.orderRepository.findOrderById(outletId, orderId, businessId);

    if (status === 'READY') {
      NotificationService.notifyOrderReady({
        id: order.id,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        outletId: order.outletId,
      }).catch(() => { });
    }

    return this.transformOrder(updated);
  }

  async getTableMenu(token: string) {
    const tokenRecord = await prisma.tableToken.findUnique({
      where: { token },
      include: {
        outlet: {
          include: { business: true }
        }
      }
    });
    if (!tokenRecord) {
      throw new AppError('INVALID_TOKEN', 'Table token is invalid', 400);
    }
    if (new Date() > tokenRecord.expiresAt) {
      throw new AppError('EXPIRED_TOKEN', 'Table token has expired', 400);
    }

    const categories = await prisma.menuCategory.findMany({
      where: {
        outletId: tokenRecord.outletId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        menuItems: {
          where: {
            isActive: true,
            deletedAt: null,
            // Same rule as order creation: the item must be assigned to THIS outlet and not marked
            // unavailable here (Menu Manager's per-branch "Unavailable" toggle sets MenuItemOutlet.isActive)
            outlets: {
              some: {
                outletId: tokenRecord.outletId,
                isActive: true,
              },
            },
          },
        },
      },
    });

    return {
      businessName: tokenRecord.outlet?.business?.name || 'Alayn Dining',
      // Don't show category tabs that have nothing orderable right now
      categories: categories.filter((category) => category.menuItems.length > 0),
    };
  }
}
export default OrderService;
