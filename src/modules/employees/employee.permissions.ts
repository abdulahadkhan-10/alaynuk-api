import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';

/**
 * Who may grant which role, and who may manage whom.
 *
 * - SUPER_ADMIN can never be granted through employee management (only via Alayn's own admin tooling).
 * - Owners can assign any business role (including co-owners).
 * - Managers can only hire/manage Staff and Kitchen — never owners or other managers.
 * - Nobody can change their own role, branches or status.
 */

export type EmployeeRole = 'BUSINESS_OWNER' | 'MANAGER' | 'STAFF' | 'KITCHEN';

export interface EmployeeActor {
  userId: string;
  role: string;
  businessId?: string | null;
}

const ASSIGNABLE_ROLES: Record<string, EmployeeRole[]> = {
  SUPER_ADMIN: ['BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'],
  BUSINESS_OWNER: ['BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'],
  MANAGER: ['STAFF', 'KITCHEN'],
};

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function getAssignableRoles(actorRole: string): EmployeeRole[] {
  return ASSIGNABLE_ROLES[actorRole] || [];
}

export function canAssignRole(actor: EmployeeActor, role: string): boolean {
  return getAssignableRoles(actor.role).includes(role as EmployeeRole);
}

export function assertCanAssignRole(actor: EmployeeActor, role: string) {
  if (!canAssignRole(actor, role)) {
    throw new AppError('FORBIDDEN', `You are not allowed to assign the ${role} role.`, 403);
  }
}

/** Managers may only manage Staff and Kitchen employees (based on the target's current role). */
export function assertCanManageEmployee(actor: EmployeeActor, target: { role: string }) {
  if (!canAssignRole(actor, target.role)) {
    throw new AppError('FORBIDDEN', `You are not allowed to manage ${target.role} accounts.`, 403);
  }
}

/**
 * Every outlet must exist, belong to the actor's business, and — for managers — be one of
 * the outlets the manager is assigned to.
 */
export async function assertOutletsAccessible(actor: EmployeeActor, outletIds: string[]) {
  if (outletIds.length === 0 || outletIds.some((id) => !UUID_REGEX.test(id))) {
    throw new AppError('OUTLET_REQUIRED', 'Please select a specific outlet for this employee.', 400);
  }

  const isSuperAdmin = actor.role === 'SUPER_ADMIN';
  if (!isSuperAdmin && !actor.businessId) {
    throw new AppError('FORBIDDEN', 'Your account is not linked to a business.', 403);
  }

  const uniqueIds = [...new Set(outletIds)];
  const outlets = await prisma.outlet.findMany({
    where: {
      id: { in: uniqueIds },
      deletedAt: null,
      ...(isSuperAdmin ? {} : { businessId: actor.businessId as string }),
    },
    select: { id: true },
  });
  if (outlets.length !== uniqueIds.length) {
    throw new AppError('FORBIDDEN', 'One or more selected outlets do not belong to your business.', 403);
  }

  if (actor.role === 'MANAGER') {
    const assigned = await prisma.userOutlet.findMany({
      where: { userId: actor.userId, outletId: { in: uniqueIds } },
      select: { outletId: true },
    });
    if (assigned.length !== uniqueIds.length) {
      throw new AppError('FORBIDDEN', 'Managers can only add employees to outlets they manage.', 403);
    }
  }
}
