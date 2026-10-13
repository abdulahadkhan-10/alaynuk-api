import { EmployeeRepository } from './employee.repository';
import { AuthRepository } from '../auth/auth.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';
import { NotificationService } from '../notifications/notification.service';
import {
  EmployeeActor,
  assertCanAssignRole,
  assertCanManageEmployee,
  assertOutletsAccessible,
} from './employee.permissions';
import { formatLeaveDate, outletToday } from './leave.helpers';

// Roles that manage leave for others (approve, or file on someone's behalf)
const LEAVE_MANAGER_ROLES = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER'];

export class EmployeeService {
  private employeeRepository = new EmployeeRepository();
  private authRepository = new AuthRepository();

  async createEmployee(outletId: string, data: any, actor: EmployeeActor) {
    if (!data.name || !data.phone || !data.role) {
      throw new AppError('VALIDATION_ERROR', 'Name, phone, and role are required', 400);
    }
    if (!data.email || !data.password) {
      throw new AppError('VALIDATION_ERROR', 'Email and password are required to create an employee login account', 400);
    }

    assertCanAssignRole(actor, data.role);

    const targetOutletIds: string[] =
      Array.isArray(data.outletIds) && data.outletIds.length > 0 ? data.outletIds : [outletId];
    await assertOutletsAccessible(actor, targetOutletIds);

    const created = await this.employeeRepository.create(outletId, { ...data, outletIds: targetOutletIds });
    if (created?.userId && data.status === 'INACTIVE') {
      await this.syncLoginAccess(created.userId);
    }
    return created;
  }

  async getEmployeeById(outletId: string, id: string, businessId?: string | null) {
    const employee = await this.employeeRepository.findById(outletId, id, businessId);
    if (!employee) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Employee not found', 404);
    }
    return employee;
  }

  async getEmployees(outletId: string, limit: number, offset: number, businessId?: string) {
    return this.employeeRepository.findMany(outletId, limit, offset, businessId);
  }

  async updateEmployee(outletId: string, id: string, data: any, actor: EmployeeActor) {
    const existing = await this.getEmployeeById(outletId, id, actor.businessId);
    const isSelf = !!existing.userId && existing.userId === actor.userId;

    if (isSelf) {
      // You may update your own name/phone/email/password, but never your own access level
      const currentOutletIds = (existing.user?.outlets || []).map((o: any) => o.outletId).sort();
      const requestedOutletIds = Array.isArray(data.outletIds) ? [...data.outletIds].sort() : null;
      const changesRole = !!data.role && data.role !== existing.role;
      const changesStatus = !!data.status && data.status !== existing.status;
      const changesOutlets =
        !!requestedOutletIds && requestedOutletIds.join(',') !== currentOutletIds.join(',');
      if (changesRole || changesStatus || changesOutlets) {
        throw new AppError('FORBIDDEN', 'You cannot change your own role, outlets or status.', 403);
      }
    } else {
      assertCanManageEmployee(actor, existing);
      if (data.role) {
        assertCanAssignRole(actor, data.role);
      }
      if (Array.isArray(data.outletIds) && data.outletIds.length > 0) {
        await assertOutletsAccessible(actor, data.outletIds);
      }
    }

    const updated = await this.employeeRepository.update(outletId, id, data);

    if (existing.userId) {
      const statusChanged = !!data.status && data.status !== existing.status;
      const accessChanged =
        (!!data.role && data.role !== existing.role) || Array.isArray(data.outletIds);

      if (statusChanged) {
        // Status applies to the person, not just this outlet's record (multi-outlet managers have one row per outlet)
        await this.employeeRepository.setStatusForUser(existing.userId, data.status);
      }
      await this.syncLoginAccess(existing.userId, { forceLogout: accessChanged });
    }

    return updated;
  }

  async deleteEmployee(outletId: string, id: string, actor: EmployeeActor) {
    const existing = await this.getEmployeeById(outletId, id, actor.businessId);
    if (existing.userId && existing.userId === actor.userId) {
      throw new AppError('FORBIDDEN', 'You cannot delete your own employee profile.', 403);
    }
    assertCanManageEmployee(actor, existing);
    const deleted = await this.employeeRepository.softDelete(outletId, id);

    if (existing.userId) {
      // Remove access to this outlet; if this was their last active role anywhere, the login is disabled too
      await this.employeeRepository.removeOutletAccess(existing.userId, existing.outletId);
      await this.syncLoginAccess(existing.userId, { forceLogout: true });
    }

    return deleted;
  }

  /**
   * Keeps the login account in line with the employee records: a user with no remaining ACTIVE,
   * non-deleted employee record cannot log in, and all their sessions are ended immediately.
   * Original business owners and super admins are never disabled here.
   */
  private async syncLoginAccess(userId: string, options: { forceLogout?: boolean } = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true, businessOwner: { select: { id: true } } },
    });
    if (!user || user.role === 'SUPER_ADMIN' || user.businessOwner) {
      return;
    }

    const activeRecords = await prisma.employee.count({
      where: { userId, deletedAt: null, status: 'ACTIVE' },
    });
    const shouldBeActive = activeRecords > 0;

    if (user.isActive !== shouldBeActive) {
      await prisma.user.update({ where: { id: userId }, data: { isActive: shouldBeActive } });
    }
    if (!shouldBeActive || options.forceLogout) {
      // Ends all saved sessions so phones that are already logged in are signed out
      await this.authRepository.deleteUserRefreshTokens(userId);
    }
  }

  async addDocument(outletId: string, employeeId: string, name: string, fileUrl: string, mimeType: string, sizeBytes: number) {
    // Verify employee belongs to business
    await this.getEmployeeById(outletId, employeeId);
    return this.employeeRepository.addDocument(employeeId, name, fileUrl, mimeType, sizeBytes);
  }

  async createLeaveRequest(
    outletId: string,
    data: { employeeId?: string; startDate: Date; endDate: Date; reason: string },
    actor: EmployeeActor,
    now: Date = new Date()
  ) {
    // Whose leave is this? Staff/Kitchen: always themselves. Owners/managers may also file for people they manage.
    let emp;
    if (data.employeeId) {
      emp = await this.getEmployeeById(outletId, data.employeeId, actor.businessId);
    } else {
      emp = await prisma.employee.findFirst({
        where: {
          userId: actor.userId,
          deletedAt: null,
          ...(outletId && outletId !== 'all' ? { outletId } : {}),
        },
      });
      if (!emp) {
        throw new AppError('EMPLOYEE_NOT_FOUND', 'Could not find your employee profile at this outlet.', 404);
      }
    }
    const isSelf = !!emp.userId && emp.userId === actor.userId;
    if (!isSelf) {
      if (!LEAVE_MANAGER_ROLES.includes(actor.role)) {
        throw new AppError('FORBIDDEN', 'You can only request leave for yourself.', 403);
      }
      assertCanManageEmployee(actor, emp);
    }

    // Date checks (dates are calendar days at UTC midnight, "today" is the outlet's local date)
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Please provide valid leave dates.', 400);
    }
    if (endDate < startDate) {
      throw new AppError('VALIDATION_ERROR', 'Leave end date cannot be before the start date.', 400);
    }
    if (startDate < outletToday(now)) {
      throw new AppError('VALIDATION_ERROR', 'Cannot apply for leave on past dates.', 400);
    }
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: emp.id,
        status: { in: ['REQUESTED', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new AppError(
        'LEAVE_OVERLAP',
        `${isSelf ? 'You already have' : `${emp.name} already has`} ${overlapping.status === 'APPROVED' ? 'an approved' : 'a pending'} leave request from ${formatLeaveDate(overlapping.startDate)} to ${formatLeaveDate(overlapping.endDate)}.`,
        400
      );
    }

    const leave = await this.employeeRepository.createLeaveRequest(emp.outletId, {
      employeeId: emp.id,
      startDate,
      endDate,
      reason: data.reason,
    });

    const outlet = await prisma.outlet.findUnique({
      where: { id: leave.outletId },
      select: { businessId: true },
    });

    NotificationService.notifyLeaveRequested({
      id: leave.id,
      employeeName: emp.name,
      reason: leave.reason,
      startDate: leave.startDate,
      endDate: leave.endDate,
      outletId: leave.outletId,
      businessId: outlet?.businessId,
    }).catch(() => {});

    return leave;
  }

  async getLeaveRequests(outletId: string, actor: EmployeeActor) {
    // Staff/Kitchen only see their own requests (reasons can be personal); managers/owners see the outlet's
    const onlyUserId = LEAVE_MANAGER_ROLES.includes(actor.role) ? undefined : actor.userId;
    return this.employeeRepository.findLeaveRequests(outletId, actor.businessId || undefined, onlyUserId);
  }

  async updateLeaveRequestStatus(
    outletId: string,
    leaveId: string,
    status: 'APPROVED' | 'REJECTED',
    actor: EmployeeActor
  ) {
    const leave = await this.employeeRepository.findLeaveRequestById(outletId, leaveId, actor.businessId);
    if (!leave) {
      throw new AppError('LEAVE_REQUEST_NOT_FOUND', 'Leave request not found', 404);
    }
    if (leave.status !== 'REQUESTED') {
      throw new AppError('INVALID_TRANSITION', 'Can only update status of REQUESTED leave requests', 400);
    }
    if (leave.employee?.userId && leave.employee.userId === actor.userId) {
      throw new AppError('FORBIDDEN', 'You cannot approve or reject your own leave.', 403);
    }
    // Managers decide Staff/Kitchen leave; a manager's leave is decided by the owner
    assertCanManageEmployee(actor, leave.employee);

    const { leave: updated, removedShiftAssignments } = await this.employeeRepository.decideLeaveRequest(
      leave,
      status,
      actor.userId
    );

    NotificationService.notifyLeaveStatusChanged({
      id: updated.id,
      userId: leave.employee?.userId || undefined,
      status: updated.status,
      outletId: updated.outletId,
    }).catch(() => {});

    return { ...updated, removedShiftAssignments };
  }
}
export default EmployeeService;

