import { prisma } from '../../config/prisma';
import { emitNotificationToRooms } from '../../config/socket';
import { logger } from '../../config/logger';
import { Role } from '@prisma/client';

export interface CreateNotificationParams {
  userId?: string;
  businessId?: string;
  outletId?: string;
  role?: Role;
  title: string;
  message: string;
  type: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, any>;
  targetRooms?: string[];
  skipEmit?: boolean;
}

export class NotificationService {
  /**
   * Persists a notification to database and broadcasts it via Socket.io to target rooms
   */
  static async createAndEmit(params: CreateNotificationParams) {
    try {
      // Every outlet notification is also tagged with its business, so it can never surface
      // in another business's notification list
      if (params.outletId && !params.businessId) {
        const outlet = await prisma.outlet.findUnique({
          where: { id: params.outletId },
          select: { businessId: true },
        });
        params = { ...params, businessId: outlet?.businessId };
      }

      const notification = await prisma.notification.create({
        data: {
          userId: params.userId || null,
          businessId: params.businessId || null,
          outletId: params.outletId || null,
          role: params.role || null,
          title: params.title,
          message: params.message,
          type: params.type,
          entityType: params.entityType || null,
          entityId: params.entityId || null,
          metadata: params.metadata ? (params.metadata as any) : undefined,
        },
      });

      if (params.skipEmit) {
        return notification;
      }

      // Construct target rooms for real-time Socket.io delivery
      const rooms: string[] = params.targetRooms || [];

      if (params.userId) {
        rooms.push(`user:${params.userId}`);
      }

      if (params.role) {
        // The platform-wide role room is only for notifications not tied to any business
        // (otherwise every manager on Alayn would receive every business's manager notifications)
        if (!params.businessId && !params.outletId) {
          rooms.push(`role:${params.role}`);
        }
        if (params.businessId) {
          rooms.push(`role:${params.role}:business:${params.businessId}`);
        }
        if (params.outletId) {
          rooms.push(`role:${params.role}:outlet:${params.outletId}`);
        }
      }

      if (params.outletId && !params.role && !params.userId) {
        rooms.push(`outlet:${params.outletId}`);
      }

      if (params.businessId && !params.role && !params.userId && !params.outletId) {
        rooms.push(`business:${params.businessId}`);
      }

      emitNotificationToRooms(rooms, notification);

      return notification;
    } catch (error: any) {
      logger.error(`Failed to create or emit notification: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * Helper: Order Placed -> Notify Kitchen, Manager, Floor Staff
   */
  static async notifyOrderPlaced(order: { id: string; orderNumber?: string | null; totalPaise: number; outletId: string; businessId?: string }, skipEmit = false) {
    const formattedAmount = (order.totalPaise / 100).toFixed(2);
    const orderRef = order.orderNumber || order.id.slice(0, 8);
    
    // Notify Kitchen
    await this.createAndEmit({
      outletId: order.outletId,
      businessId: order.businessId,
      role: Role.KITCHEN,
      title: 'New Order Received',
      message: `Order #${orderRef} (₹${formattedAmount}) sent to kitchen.`,
      type: 'ORDER_PLACED',
      entityType: 'ORDER',
      entityId: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      skipEmit,
    });

    // Notify Outlet Manager
    await this.createAndEmit({
      outletId: order.outletId,
      businessId: order.businessId,
      role: Role.MANAGER,
      title: 'New Order Placed',
      message: `Order #${orderRef} (₹${formattedAmount}) was placed.`,
      type: 'ORDER_PLACED',
      entityType: 'ORDER',
      entityId: order.id,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
      skipEmit,
    });
  }

  /**
   * Helper: Order Ready -> Notify Floor Staff & Manager
   */
  static async notifyOrderReady(order: { id: string; orderNumber?: string | null; tableNumber?: number | null; outletId: string }, skipEmit = false) {
    const orderRef = order.orderNumber || order.id.slice(0, 8);
    const tableText = order.tableNumber ? ` (Table ${order.tableNumber})` : '';

    await this.createAndEmit({
      outletId: order.outletId,
      role: Role.STAFF,
      title: 'Order Ready for Pickup',
      message: `Order #${orderRef}${tableText} is ready to serve!`,
      type: 'ORDER_READY',
      entityType: 'ORDER',
      entityId: order.id,
      metadata: { orderId: order.id, tableNumber: order.tableNumber },
      skipEmit,
    });
  }

  /**
   * Helper: Low Stock / Expiry Alert -> Notify Manager & BO Manager
   */
  static async notifyStockAlert(alert: { id: string; itemName: string; type: 'LOW_STOCK' | 'EXPIRY'; message: string; outletId: string; businessId?: string }, skipEmit = false) {
    const isLow = alert.type === 'LOW_STOCK';
    const title = isLow ? 'Low Stock Warning' : 'Item Expiry Alert';

    await this.createAndEmit({
      outletId: alert.outletId,
      businessId: alert.businessId,
      role: Role.MANAGER,
      title,
      message: alert.message,
      type: isLow ? 'LOW_STOCK' : 'EXPIRY_ALERT',
      entityType: 'STOCK',
      entityId: alert.id,
      metadata: { itemName: alert.itemName },
      skipEmit,
    });

    if (alert.businessId) {
      await this.createAndEmit({
        businessId: alert.businessId,
        role: Role.BUSINESS_OWNER,
        title,
        message: alert.message,
        type: isLow ? 'LOW_STOCK' : 'EXPIRY_ALERT',
        entityType: 'STOCK',
        entityId: alert.id,
        metadata: { itemName: alert.itemName },
        skipEmit,
      });
    }
  }

  /**
   * Helper: Purchase Order Status Changed -> Notify Supplier / Manager / Business Owner
   */
  static async notifyPOStatusChanged(po: { id: string; supplierId: string; supplierUserId?: string | null; status: string; totalAmountPaise: number; outletId: string; businessId?: string }, skipEmit = false) {
    const poRef = `PO-${po.id.slice(0, 5).toUpperCase()}`;
    const formattedAmount = (po.totalAmountPaise / 100).toFixed(2);

    if (po.status === 'SENT') {
      const targetRooms = [`supplier:${po.supplierId}`];
      await this.createAndEmit({
        userId: po.supplierUserId || undefined,
        outletId: po.outletId,
        role: Role.SUPPLIER,
        title: 'New Purchase Order Received',
        message: `PO #${poRef} worth ₹${formattedAmount} has been sent to you.`,
        type: 'PO_SENT',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        targetRooms,
        metadata: { poId: po.id, status: po.status },
        skipEmit,
      });
    } else if (po.status === 'DISPATCHED' || po.status === 'PARTIALLY_DISPATCHED') {
      await this.createAndEmit({
        outletId: po.outletId,
        businessId: po.businessId,
        role: Role.MANAGER,
        title: 'Purchase Order Dispatched',
        message: `PO #${poRef} has been marked as ${po.status.toLowerCase()} by supplier.`,
        type: 'PO_DISPATCHED',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        metadata: { poId: po.id, status: po.status },
        skipEmit,
      });
    } else if (po.status === 'CANCELLED') {
      // Tell the supplier to stop packing / not dispatch
      await this.createAndEmit({
        userId: po.supplierUserId || undefined,
        outletId: po.outletId,
        role: Role.SUPPLIER,
        title: 'Purchase Order Cancelled',
        message: `PO #${poRef} worth ₹${formattedAmount} has been cancelled. Please do not dispatch it.`,
        type: 'PO_CANCELLED',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        targetRooms: [`supplier:${po.supplierId}`],
        metadata: { poId: po.id, status: po.status },
        skipEmit,
      });
    } else if (po.status === 'RECEIVED' || po.status === 'CLOSED') {
      await this.createAndEmit({
        outletId: po.outletId,
        businessId: po.businessId,
        role: Role.BUSINESS_OWNER,
        title: 'Purchase Order Fulfilled',
        message: `PO #${poRef} has been completed and received.`,
        type: 'PO_RECEIVED',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        metadata: { poId: po.id, status: po.status },
        skipEmit,
      });
    }
  }

  /**
   * Helper: Leave Request -> Notify Manager & BO Manager
   */
  static async notifyLeaveRequested(leave: { id: string; employeeName: string; reason: string; startDate: Date; endDate: Date; outletId: string; businessId?: string }, skipEmit = false) {
    await this.createAndEmit({
      outletId: leave.outletId,
      businessId: leave.businessId,
      role: Role.MANAGER,
      title: 'New Leave Request',
      message: `${leave.employeeName} submitted a leave request: "${leave.reason}".`,
      type: 'LEAVE_REQUESTED',
      entityType: 'LEAVE_REQUEST',
      entityId: leave.id,
      metadata: { employeeName: leave.employeeName },
      skipEmit,
    });

    if (leave.businessId) {
      await this.createAndEmit({
        businessId: leave.businessId,
        role: Role.BUSINESS_OWNER,
        title: 'Leave Request Received',
        message: `${leave.employeeName} requested leave in outlet.`,
        type: 'LEAVE_REQUESTED',
        entityType: 'LEAVE_REQUEST',
        entityId: leave.id,
        metadata: { employeeName: leave.employeeName },
        skipEmit,
      });
    }
  }

  /**
   * Helper: Leave Request Status Changed -> Notify Employee User
   */
  static async notifyLeaveStatusChanged(leave: { id: string; userId?: string | null; status: string; outletId: string }, skipEmit = false) {
    if (!leave.userId) return;

    await this.createAndEmit({
      userId: leave.userId,
      outletId: leave.outletId,
      title: 'Leave Request Updated',
      message: `Your leave request status is now: ${leave.status}.`,
      type: 'LEAVE_STATUS_CHANGED',
      entityType: 'LEAVE_REQUEST',
      entityId: leave.id,
      metadata: { status: leave.status },
      skipEmit,
    });
  }

  /**
   * Helper: Shift Swap Requested -> Notify target employee & Manager
   */
  static async notifyShiftSwapRequested(swap: { id: string; fromName: string; toUserId?: string | null; date: Date; outletId: string }, skipEmit = false) {
    if (swap.toUserId) {
      await this.createAndEmit({
        userId: swap.toUserId,
        outletId: swap.outletId,
        title: 'Shift Swap Request',
        message: `${swap.fromName} requested to swap shifts with you.`,
        type: 'SHIFT_SWAP_REQUESTED',
        entityType: 'SHIFT_SWAP',
        entityId: swap.id,
        metadata: { fromName: swap.fromName },
        skipEmit,
      });
    }

    await this.createAndEmit({
      outletId: swap.outletId,
      role: Role.MANAGER,
      title: 'Shift Swap Requested',
      message: `Shift swap requested by ${swap.fromName}.`,
      type: 'SHIFT_SWAP_REQUESTED',
      entityType: 'SHIFT_SWAP',
      entityId: swap.id,
      skipEmit,
    });
  }

  /**
   * Helper: Ticket Created -> Notify Manager & BO Manager
   */
  static async notifyTicketCreated(ticket: { id: string; title: string; priority: string; outletId: string; businessId?: string }, skipEmit = false) {
    await this.createAndEmit({
      outletId: ticket.outletId,
      businessId: ticket.businessId,
      role: Role.MANAGER,
      title: `Support Ticket (${ticket.priority})`,
      message: `New ticket created: "${ticket.title}".`,
      type: 'TICKET_CREATED',
      entityType: 'TICKET',
      entityId: ticket.id,
      metadata: { priority: ticket.priority },
      skipEmit,
    });

    if (ticket.businessId) {
      await this.createAndEmit({
        businessId: ticket.businessId,
        role: Role.BUSINESS_OWNER,
        title: `Support Ticket Escalation`,
        message: `Ticket "${ticket.title}" opened in outlet.`,
        type: 'TICKET_CREATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        metadata: { priority: ticket.priority },
        skipEmit,
      });
    }
  }

  /**
   * Helper: High Waste Logged -> Notify Manager & BO Manager
   */
  static async notifyHighWasteLogged(waste: { id: string; itemName: string; quantity: string | number; costPaise: number; outletId: string; businessId?: string }, skipEmit = false) {
    const formattedCost = (waste.costPaise / 100).toFixed(2);
    
    await this.createAndEmit({
      outletId: waste.outletId,
      businessId: waste.businessId,
      role: Role.MANAGER,
      title: 'High Waste Recorded',
      message: `Waste logged for ${waste.itemName} (${waste.quantity} units, ₹${formattedCost}).`,
      type: 'HIGH_WASTE_LOGGED',
      entityType: 'WASTE',
      entityId: waste.id,
      metadata: { itemName: waste.itemName, costPaise: waste.costPaise },
      skipEmit,
    });

    if (waste.businessId) {
      await this.createAndEmit({
        businessId: waste.businessId,
        role: Role.BUSINESS_OWNER,
        title: 'Waste Alert for BO Manager',
        message: `High waste logged: ${waste.itemName} (₹${formattedCost}).`,
        type: 'HIGH_WASTE_LOGGED',
        entityType: 'WASTE',
        entityId: waste.id,
        metadata: { itemName: waste.itemName },
        skipEmit,
      });
    }
  }

  /**
   * Syncs existing open tickets, pending POs, low stock alerts, and pending leave requests
   * into the Notification table so users immediately see active alerts for open module items!
   * NOTE: Passes skipEmit = true to prevent flooding user screens with popups on page loads!
   */
  static async syncPendingSystemNotifications(businessId?: string | null, outletId?: string | null) {
    try {
      const isUuid = (id?: string | null) => !!id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
      const validOutletId = isUuid(outletId) ? outletId : undefined;
      const validBusinessId = isUuid(businessId) ? businessId : undefined;

      let outletIds: string[] | undefined = undefined;

      if (validOutletId) {
        outletIds = [validOutletId];
      } else if (validBusinessId) {
        const businessOutlets = await prisma.outlet.findMany({
          where: { businessId: validBusinessId },
          select: { id: true },
        });
        outletIds = businessOutlets.map((o) => o.id);
      }

      const outletWhere = outletIds ? { outletId: { in: outletIds } } : {};

      // 1. Sync Open Tickets
      const openTickets = await prisma.ticket.findMany({
        where: {
          ...outletWhere,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        take: 20,
      });

      for (const ticket of openTickets) {
        const existing = await prisma.notification.findFirst({
          where: { entityType: 'TICKET', entityId: ticket.id },
        });
        if (!existing) {
          const outlet = await prisma.outlet.findUnique({ where: { id: ticket.outletId }, select: { businessId: true } });
          await this.notifyTicketCreated(
            {
              id: ticket.id,
              title: ticket.title,
              priority: ticket.priority,
              outletId: ticket.outletId,
              businessId: outlet?.businessId,
            },
            true // skipEmit = true (silent DB sync)
          );
        }
      }

      // 2. Sync Pending Purchase Orders
      const pendingPOs = await prisma.purchaseOrder.findMany({
        where: {
          ...outletWhere,
          status: { in: ['DRAFT', 'SENT', 'PACKING', 'OUT_OF_STOCK', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'PARTIALLY_RECEIVED'] },
        },
        include: { actualSupplier: true },
        take: 20,
      });

      for (const po of pendingPOs) {
        const existing = await prisma.notification.findFirst({
          where: { entityType: 'PURCHASE_ORDER', entityId: po.id },
        });
        if (!existing) {
          await this.notifyPOStatusChanged(
            {
              id: po.id,
              supplierId: po.supplierId,
              supplierUserId: po.actualSupplier?.userId,
              status: po.status,
              totalAmountPaise: po.totalAmountPaise,
              outletId: po.outletId,
            },
            true // skipEmit = true (silent DB sync)
          );
        }
      }

      // 3. Sync Pending Leave Requests
      const pendingLeaves = await prisma.leaveRequest.findMany({
        where: {
          ...outletWhere,
          status: 'REQUESTED',
        },
        include: { employee: true },
        take: 20,
      });

      for (const leave of pendingLeaves) {
        const existing = await prisma.notification.findFirst({
          where: { entityType: 'LEAVE_REQUEST', entityId: leave.id },
        });
        if (!existing) {
          const outlet = await prisma.outlet.findUnique({ where: { id: leave.outletId }, select: { businessId: true } });
          await this.notifyLeaveRequested(
            {
              id: leave.id,
              employeeName: leave.employee?.name || 'Employee',
              reason: leave.reason,
              startDate: leave.startDate,
              endDate: leave.endDate,
              outletId: leave.outletId,
              businessId: outlet?.businessId,
            },
            true // skipEmit = true (silent DB sync)
          );
        }
      }
    } catch (err: any) {
      logger.error(`Error syncing system notifications: ${err?.message || err}`);
    }
  }

}


