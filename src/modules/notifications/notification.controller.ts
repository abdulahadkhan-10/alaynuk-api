import { Response } from 'express';
import { Role } from '@prisma/client';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import { NotificationService } from './notification.service';

const isUuid = (id?: string | null): boolean =>
  !!id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);

export class NotificationController {
  private static buildWhereClause(req: AuthenticatedRequest, unreadOnly?: boolean) {
    const user = req.user;
    if (!user) return null;

    const validUserId = isUuid(user.id) ? user.id : null;
    const validBusinessId = isUuid(user.businessId) ? user.businessId : null;
    const validOutletId = isUuid(req.outletId) ? req.outletId : null;

    const orConditions: any[] = [];

    // 1. Direct user notifications
    if (validUserId) {
      orConditions.push({ userId: validUserId });
    }

    // 2. Role-based notifications
    if (user.role) {
      if (user.role === 'SUPPLIER') {
        // Suppliers only get notifications addressed to them personally (e.g. their own purchase orders),
        // never every supplier notification on the platform
      } else {
        const allowedRoles: Role[] = [user.role as Role];
        if (user.role === 'BUSINESS_OWNER' || user.role === 'SUPER_ADMIN') {
          allowedRoles.push(Role.BUSINESS_OWNER, Role.MANAGER, Role.SUPER_ADMIN, Role.STAFF, Role.KITCHEN);
        } else if (user.role === 'MANAGER') {
          allowedRoles.push(Role.MANAGER, Role.STAFF, Role.KITCHEN);
        }

        const roleWhere: any = { role: { in: allowedRoles } };
        const andList: any[] = [];

        if (validBusinessId) {
          andList.push({
            OR: [
              { businessId: validBusinessId },
              // Older notifications saved without a business tag: allowed only if their outlet is ours
              { businessId: null, outlet: { businessId: validBusinessId } },
              // Platform-wide notices (no business, no outlet)
              { businessId: null, outletId: null },
            ],
          });
        } else if (user.role !== 'SUPER_ADMIN') {
          // No business on the account: only platform-wide notices
          andList.push({ businessId: null, outletId: null });
        }
        if (validOutletId) {
          andList.push({ OR: [{ outletId: validOutletId }, { outletId: null }] });
        }

        if (andList.length > 0) {
          roleWhere.AND = andList;
        }
        orConditions.push(roleWhere);

        // 3. Outlet-scoped notifications (excluding supplier-only notifications)
        if (validOutletId) {
          orConditions.push({ outletId: validOutletId, OR: [{ role: { not: Role.SUPPLIER } }, { role: null }] });
        }

        // 4. Business-scoped notifications (excluding supplier-only notifications)
        if (validBusinessId) {
          orConditions.push({ businessId: validBusinessId, OR: [{ role: { not: Role.SUPPLIER } }, { role: null }] });
        }
      }
    }

    if (orConditions.length === 0) {
      return { id: '00000000-0000-0000-0000-000000000000' };
    }

    return {
      OR: orConditions,
      ...(unreadOnly ? { isRead: false } : {}),
    };
  }

  /**
   * Get paginated notifications for current user/role
   */
  static async getNotifications(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unreadOnly === 'true';
      const skip = (page - 1) * limit;

      const whereClause = NotificationController.buildWhereClause(req, unreadOnly);
      const unreadWhereClause = NotificationController.buildWhereClause(req, true);

      if (!whereClause || !unreadWhereClause) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const [rawNotifications, total, unreadRawCount] = await Promise.all([
        prisma.notification.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit * 2, // Fetch slightly larger window to account for deduplication
        }),
        prisma.notification.count({ where: whereClause }),
        prisma.notification.count({ where: unreadWhereClause }),
      ]);

      // Deduplicate notifications by entityType + entityId or title + message
      const seenKeys = new Set<string>();
      const uniqueNotifications = rawNotifications.filter((n) => {
        const key = n.entityType && n.entityId
          ? `${n.entityType}:${n.entityId}`
          : `${n.title}:${n.message}:${new Date(n.createdAt).toISOString().slice(0, 16)}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      }).slice(0, limit);

      const unreadCount = uniqueNotifications.filter((n) => !n.isRead).length || unreadRawCount;

      return res.status(200).json({
        success: true,
        data: uniqueNotifications,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          unreadCount,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message || 'Failed to fetch notifications' });
    }
  }

  /**
   * Get unread notification count
   */
  static async getUnreadCount(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const unreadWhereClause = NotificationController.buildWhereClause(req, true);
      if (!unreadWhereClause) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const unreadCount = await prisma.notification.count({
        where: unreadWhereClause,
      });

      return res.status(200).json({
        success: true,
        data: { unreadCount },
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message || 'Failed to fetch unread count' });
    }
  }

  /**
   * Mark a single notification as read
   */
  static async markAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid notification ID' });
      }

      // Only notifications this user can actually see
      const visibleWhere = NotificationController.buildWhereClause(req);
      if (!visibleWhere) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const result = await prisma.notification.updateMany({
        where: { AND: [{ id }, visibleWhere] },
        data: { isRead: true },
      });
      if (result.count === 0) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }
      const updated = await prisma.notification.findUnique({ where: { id } });

      return res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message || 'Failed to mark notification as read' });
    }
  }

  /**
   * Mark all notifications as read for current user/scope
   */
  static async markAllAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      const unreadWhereClause = NotificationController.buildWhereClause(req, true);
      if (!unreadWhereClause) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      await prisma.notification.updateMany({
        where: unreadWhereClause,
        data: { isRead: true },
      });

      return res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message || 'Failed to mark all as read' });
    }
  }

  /**
   * Delete a notification
   */
  static async deleteNotification(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid notification ID' });
      }

      // Only notifications this user can actually see
      const visibleWhere = NotificationController.buildWhereClause(req);
      if (!visibleWhere) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const result = await prisma.notification.deleteMany({
        where: { AND: [{ id }, visibleWhere] },
      });
      if (result.count === 0) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification deleted',
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message || 'Failed to delete notification' });
    }
  }
}

