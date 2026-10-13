import { prisma } from '../../config/prisma';
import { outletScope } from '../../utils/tenantScope';

export class ShiftRepository {
  async createShift(outletId: string, data: any) {
    return prisma.shift.create({
      data: {
        ...data,
        outletId,
      },
    });
  }

  async findShiftById(outletId: string, id: string, businessId?: string | null) {
    // In "all outlets" mode, only shift templates of the caller's own business
    return prisma.shift.findFirst({
      where: { id, deletedAt: null, ...outletScope(outletId, businessId) },
    });
  }

  async findShiftAssignmentsForEmployee(employeeId: string, date: Date) {
    return prisma.shiftAssignment.findMany({
      where: {
        employeeId,
        date,
      },
      include: {
        shift: true,
      },
    });
  }

  async createShiftAssignment(outletId: string, employeeId: string, shiftId: string, date: Date) {
    return prisma.shiftAssignment.create({
      data: {
        outletId,
        employeeId,
        shiftId,
        date,
      },
    });
  }

  async createSwapRequest(outletId: string, data: any) {
    return prisma.shiftSwapRequest.create({
      data: {
        ...data,
        outletId,
      },
    });
  }

  async findSwapRequestById(outletId: string, id: string, businessId?: string | null) {
    const isAll = !outletId || outletId === 'all';
    // In "all outlets" mode, still restrict the lookup to the caller's own business
    const where = isAll ? { id, ...(businessId ? { outlet: { businessId } } : {}) } : { id, outletId };
    return prisma.shiftSwapRequest.findFirst({
      where,
      include: {
        shift: true,
      },
    });
  }

  async updateSwapRequestStatus(id: string, status: 'ACCEPTED' | 'APPROVED' | 'REJECTED') {
    return prisma.shiftSwapRequest.update({
      where: { id },
      data: { status },
    });
  }

  async findShiftAssignment(employeeId: string, shiftId: string, date: Date) {
    return prisma.shiftAssignment.findUnique({
      where: {
        employeeId_shiftId_date: {
          employeeId,
          shiftId,
          date,
        },
      },
    });
  }

  async findShifts(outletId: string, businessId?: string) {
    const isAll = !outletId || outletId === 'all';
    const where: any = isAll ? { deletedAt: null } : { outletId, deletedAt: null };
    if (isAll && businessId) {
      where.outlet = { businessId };
    }
    return prisma.shift.findMany({
      where,
      include: {
        outlet: { select: { id: true, name: true } },
        assignments: {
          include: {
            employee: true,
          },
        },
        swapRequests: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateShiftAssignmentEmployee(id: string, employeeId: string) {
    return prisma.shiftAssignment.update({
      where: { id },
      data: { employeeId },
    });
  }

  async findEmployeeRoster(employeeId: string) {
    return prisma.employeeRoster.findMany({
      where: { employeeId },
      include: {
        shift: true,
      },
    });
  }

  async findOutletRosters(outletId: string, businessId?: string) {
    const isAll = !outletId || outletId === 'all';
    const where: any = isAll ? {} : { outletId };
    if (isAll && businessId) {
      where.employee = { outlet: { businessId } };
    }
    return prisma.employeeRoster.findMany({
      where,
      include: {
        employee: true,
        shift: true,
      },
    });
  }

  async upsertEmployeeRoster(outletId: string, employeeId: string, dayOfWeek: any, shiftId: string | null) {
    return prisma.employeeRoster.upsert({
      where: {
        employeeId_dayOfWeek: {
          employeeId,
          dayOfWeek,
        },
      },
      update: {
        shiftId,
        outletId,
      },
      create: {
        employeeId,
        dayOfWeek,
        shiftId,
        outletId,
      },
    });
  }

  async findShiftAssignmentById(id: string, outletId?: string, businessId?: string | null) {
    // Scoped to the selected outlet, or in "all outlets" mode to the caller's business
    return prisma.shiftAssignment.findFirst({
      where: { id, ...outletScope(outletId, businessId) },
      include: {
        shift: true,
        employee: true,
      },
    });
  }

  async deleteShiftAssignment(id: string) {
    return prisma.shiftAssignment.delete({
      where: { id },
    });
  }

  async updateShiftAssignment(id: string, data: { shiftId?: string; date?: Date }) {
    return prisma.shiftAssignment.update({
      where: { id },
      data,
      include: {
        shift: true,
        employee: true,
      },
    });
  }

  async updateShift(id: string, data: { name?: string; startTime?: string; endTime?: string }) {
    return prisma.shift.update({
      where: { id },
      data,
    });
  }

  async deleteShift(id: string) {
    return prisma.shift.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
export default ShiftRepository;
