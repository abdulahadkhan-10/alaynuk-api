import { ShiftRepository } from './shift.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';
import { findApprovedLeaveOn, formatLeaveDate } from '../employees/leave.helpers';
import { EmployeeActor, assertCanManageEmployee } from '../employees/employee.permissions';

// Roles that can approve swaps / request swaps on someone else's behalf
const SWAP_MANAGER_ROLES = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER'];

export class ShiftService {
  private shiftRepository = new ShiftRepository();

  private async assertNotOnLeave(employee: { id: string; name: string }, date: Date) {
    const leave = await findApprovedLeaveOn(employee.id, date);
    if (leave) {
      throw new AppError(
        'ON_LEAVE',
        `${employee.name} is on approved leave on ${formatLeaveDate(new Date(date))}.`,
        400
      );
    }
  }

  async createShift(outletId: string, data: any) {
    return this.shiftRepository.createShift(outletId, data);
  }

  async getShifts(outletId: string, businessId?: string) {
    return this.shiftRepository.findShifts(outletId, businessId);
  }

  async assignShift(
    outletId: string,
    shiftId: string,
    employeeId: string,
    date: Date,
    replaceExisting: boolean = false,
    businessId?: string | null
  ) {
    // 0. Prevent backdated assignment
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const assignDate = new Date(date);
    assignDate.setHours(0, 0, 0, 0);
    if (assignDate < today) {
      throw new AppError('BACKDATED_ASSIGNMENT_NOT_ALLOWED', 'Allocating duty for backdated dates is not allowed', 400);
    }

    // 1. Load shift details
    const targetShift = await this.shiftRepository.findShiftById(outletId, shiftId, businessId);
    if (!targetShift) {
      throw new AppError('SHIFT_NOT_FOUND', 'Shift not found', 404);
    }

    // 1b. The employee must work at the shift's outlet and must not be on approved leave that day
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!emp || emp.outletId !== targetShift.outletId) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Employee not found at this outlet', 404);
    }
    const leave = await findApprovedLeaveOn(employeeId, date);
    if (leave) {
      throw new AppError(
        'ON_LEAVE',
        `${emp.name} is on approved leave on ${formatLeaveDate(new Date(date))} (${formatLeaveDate(leave.startDate)} to ${formatLeaveDate(leave.endDate)}).`,
        400
      );
    }

    // 2. Fetch existing assignments on this date
    const existingAssignments = await this.shiftRepository.findShiftAssignmentsForEmployee(employeeId, date);

    // 3. Check for overlaps: existingStart < newEnd AND existingEnd > newStart
    const newStart = targetShift.startTime;
    const newEnd = targetShift.endTime;

    const overlappingAssignments = existingAssignments.filter((assignment) => {
      const existingStart = assignment.shift.startTime;
      const existingEnd = assignment.shift.endTime;
      return existingStart < newEnd && existingEnd > newStart;
    });

    if (overlappingAssignments.length > 0) {
      if (replaceExisting) {
        for (const overlap of overlappingAssignments) {
          await this.shiftRepository.deleteShiftAssignment(overlap.id);
        }
      } else {
        const firstOverlap = overlappingAssignments[0];
        throw new AppError(
          'SHIFT_OVERLAP',
          `Shift overlaps with existing shift: ${firstOverlap.shift.name} (${firstOverlap.shift.startTime} - ${firstOverlap.shift.endTime})`,
          400
        );
      }
    }

    // 4. Assign shift
    return this.shiftRepository.createShiftAssignment(emp.outletId, employeeId, shiftId, date);
  }

  async assignShiftBulk(
    outletId: string,
    shiftId: string,
    employeeIds: string[],
    date: Date,
    replaceExisting: boolean = false,
    businessId?: string | null
  ): Promise<{ assignedCount: number; total: number; results: any[]; errors: any[] }> {
    const results: any[] = [];
    const errors: any[] = [];

    for (const empId of employeeIds) {
      try {
        const assigned = await this.assignShift(outletId, shiftId, empId, date, replaceExisting, businessId);
        results.push(assigned);
      } catch (err: any) {
        errors.push({ employeeId: empId, error: err.message });
      }
    }

    return { assignedCount: results.length, total: employeeIds.length, results, errors };
  }

  /**
   * Swap flow: the employee offers THEIR OWN shift to a colleague (REQUESTED) → the colleague accepts
   * (ACCEPTED) → a manager approves (APPROVED) and the shift moves. Anyone can be rejected along the way.
   */
  async createSwapRequest(
    outletId: string,
    data: { fromEmployeeId: string; toEmployeeId: string; shiftId: string; date: Date },
    actor: EmployeeActor
  ) {
    const isAll = !outletId || outletId === 'all';
    const fromEmployee = await prisma.employee.findFirst({
      where: { id: data.fromEmployeeId, deletedAt: null, ...(isAll ? {} : { outletId }) },
    });
    if (!fromEmployee) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Employee giving up the shift was not found', 404);
    }
    const isOwnShift = !!fromEmployee.userId && fromEmployee.userId === actor.userId;
    if (!isOwnShift) {
      if (!SWAP_MANAGER_ROLES.includes(actor.role)) {
        throw new AppError('FORBIDDEN', 'You can only offer your own shift for a swap.', 403);
      }
      assertCanManageEmployee(actor, fromEmployee);
    }
    if (data.toEmployeeId === data.fromEmployeeId) {
      throw new AppError('VALIDATION_ERROR', 'Choose a different colleague to take the shift.', 400);
    }

    // Verify fromEmployee has the assignment
    const assignment = await this.shiftRepository.findShiftAssignment(
      data.fromEmployeeId,
      data.shiftId,
      data.date
    );
    if (!assignment) {
      throw new AppError('ASSIGNMENT_NOT_FOUND', 'From-employee does not have the specified shift assigned on this date', 400);
    }

    // Verify toEmployee exists at the same outlet and can work that day
    const toEmployee = await prisma.employee.findFirst({
      where: { id: data.toEmployeeId, outletId: fromEmployee.outletId, deletedAt: null },
    });
    if (!toEmployee) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'To-employee not found', 404);
    }
    if (toEmployee.status !== 'ACTIVE') {
      throw new AppError('INACTIVE_EMPLOYEE', 'To-employee is not active', 400);
    }
    await this.assertNotOnLeave(toEmployee, data.date);

    return this.shiftRepository.createSwapRequest(fromEmployee.outletId, {
      fromEmployeeId: data.fromEmployeeId,
      toEmployeeId: data.toEmployeeId,
      shiftId: data.shiftId,
      date: data.date,
    });
  }

  /** The colleague receiving the shift accepts or declines before any manager approval. */
  async respondToSwap(outletId: string, swapId: string, accept: boolean, actor: EmployeeActor) {
    const swap = await this.shiftRepository.findSwapRequestById(outletId, swapId, actor.businessId);
    if (!swap) {
      throw new AppError('SWAP_REQUEST_NOT_FOUND', 'Shift swap request not found', 404);
    }
    const toEmployee = await prisma.employee.findFirst({ where: { id: swap.toEmployeeId, deletedAt: null } });
    if (!toEmployee || !toEmployee.userId || toEmployee.userId !== actor.userId) {
      throw new AppError('FORBIDDEN', 'Only the colleague being asked to take the shift can respond.', 403);
    }
    if (swap.status !== 'REQUESTED') {
      throw new AppError('INVALID_TRANSITION', 'This swap request has already been answered.', 400);
    }
    if (accept) {
      await this.assertNotOnLeave(toEmployee, swap.date);
    }
    return this.shiftRepository.updateSwapRequestStatus(swapId, accept ? 'ACCEPTED' : 'REJECTED');
  }

  async updateSwapStatus(outletId: string, swapId: string, status: 'APPROVED' | 'REJECTED', actor: EmployeeActor) {
    const swap = await this.shiftRepository.findSwapRequestById(outletId, swapId, actor.businessId);
    if (!swap) {
      throw new AppError('SWAP_REQUEST_NOT_FOUND', 'Shift swap request not found', 404);
    }
    if (swap.status !== 'REQUESTED' && swap.status !== 'ACCEPTED') {
      throw new AppError('INVALID_TRANSITION', 'This swap request has already been decided.', 400);
    }

    // Managers decide swaps between Staff/Kitchen; swaps involving managers are decided by the owner
    const involved = await prisma.employee.findMany({
      where: { id: { in: [swap.fromEmployeeId, swap.toEmployeeId] } },
    });
    for (const employee of involved) {
      if (employee.userId && employee.userId === actor.userId) {
        throw new AppError('FORBIDDEN', 'You cannot approve or reject a swap involving your own shift.', 403);
      }
      assertCanManageEmployee(actor, employee);
    }

    if (status === 'REJECTED') {
      return this.shiftRepository.updateSwapRequestStatus(swapId, 'REJECTED');
    }

    if (swap.status !== 'ACCEPTED') {
      throw new AppError(
        'SWAP_NOT_ACCEPTED',
        'The colleague has not accepted this swap yet. It can be approved once they accept.',
        400
      );
    }

    const toEmployeeRecord = involved.find((e) => e.id === swap.toEmployeeId);
    if (toEmployeeRecord) {
      await this.assertNotOnLeave(toEmployeeRecord, swap.date);
    }

    // If APPROVED, perform transaction
    return prisma.$transaction(async (tx) => {
      // 1. Check target employee exists and is active
      const toEmployee = await tx.employee.findFirst({
        where: { id: swap.toEmployeeId, outletId: swap.outletId, deletedAt: null },
      });
      if (!toEmployee) {
        throw new AppError('EMPLOYEE_NOT_FOUND', 'Target employee not found', 404);
      }
      if (toEmployee.status !== 'ACTIVE') {
        throw new AppError('INACTIVE_EMPLOYEE', 'Target employee is not active', 400);
      }

      // 2. Check for shift assignment of fromEmployee
      const assignment = await tx.shiftAssignment.findUnique({
        where: {
          employeeId_shiftId_date: {
            employeeId: swap.fromEmployeeId,
            shiftId: swap.shiftId,
            date: swap.date,
          },
        },
      });
      if (!assignment) {
        throw new AppError('ASSIGNMENT_NOT_FOUND', 'Source shift assignment not found', 404);
      }

      // 3. Check for overlap on target employee on that date
      const targetAssignments = await tx.shiftAssignment.findMany({
        where: {
          employeeId: swap.toEmployeeId,
          date: swap.date,
        },
        include: {
          shift: true,
        },
      });

      const newStart = swap.shift.startTime;
      const newEnd = swap.shift.endTime;

      for (const ta of targetAssignments) {
        const existingStart = ta.shift.startTime;
        const existingEnd = ta.shift.endTime;

        if (existingStart < newEnd && existingEnd > newStart) {
          throw new AppError(
            'SHIFT_OVERLAP',
            `Target employee has an overlapping shift: ${ta.shift.name} (${existingStart} - ${existingEnd})`,
            400
          );
        }
      }

      // 4. Delete the old assignment and create the new assignment (due to compound primary key constraints)
      await tx.shiftAssignment.delete({
        where: { id: assignment.id },
      });

      await tx.shiftAssignment.create({
        data: {
          outletId: swap.outletId,
          employeeId: swap.toEmployeeId,
          shiftId: swap.shiftId,
          date: swap.date,
        },
      });

      // 5. Update swap request status
      return tx.shiftSwapRequest.update({
        where: { id: swapId },
        data: { status: 'APPROVED' },
      });
    });
  }

  async getEmployeeRoster(employeeId: string) {
    return this.shiftRepository.findEmployeeRoster(employeeId);
  }

  async getOutletRosters(outletId: string, businessId?: string) {
    return this.shiftRepository.findOutletRosters(outletId, businessId);
  }

  async setWeeklyRoster(
    outletId: string,
    employeeId: string,
    weeklySchedule: Array<{ dayOfWeek: string; shiftId: string | null }>
  ) {
    let targetOutletId = outletId;
    if (!targetOutletId || targetOutletId === "all") {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (emp?.outletId) {
        targetOutletId = emp.outletId;
      } else {
        throw new AppError("VALIDATION_ERROR", "Target employee has no associated outlet for roster", 400);
      }
    }

    const results = [];
    for (const item of weeklySchedule) {
      const updated = await this.shiftRepository.upsertEmployeeRoster(
        targetOutletId,
        employeeId,
        item.dayOfWeek as any,
        item.shiftId
      );
      results.push(updated);
    }
    return results;
  }

  async deleteShiftAssignment(outletId: string, assignmentId: string, businessId?: string | null) {
    // Only assignments of the selected outlet (or, in "all outlets" mode, of the caller's business)
    const assignment = await this.shiftRepository.findShiftAssignmentById(assignmentId, outletId, businessId);
    if (!assignment) {
      throw new AppError('ASSIGNMENT_NOT_FOUND', 'Shift assignment not found', 404);
    }
    return this.shiftRepository.deleteShiftAssignment(assignmentId);
  }

  async updateShiftAssignment(
    outletId: string,
    assignmentId: string,
    data: { shiftId?: string; startTime?: string; endTime?: string; date?: Date },
    businessId?: string | null
  ) {
    // Only assignments of the selected outlet (or, in "all outlets" mode, of the caller's business)
    const assignment = await this.shiftRepository.findShiftAssignmentById(assignmentId, outletId, businessId);
    if (!assignment) {
      throw new AppError('ASSIGNMENT_NOT_FOUND', 'Shift assignment not found', 404);
    }

    let targetShiftId = assignment.shiftId;
    let targetStart = assignment.shift.startTime;
    let targetEnd = assignment.shift.endTime;

    // Custom time edit
    if (data.startTime && data.endTime) {
      targetStart = data.startTime;
      targetEnd = data.endTime;
      const existingShift = await prisma.shift.findFirst({
        where: {
          outletId: assignment.outletId,
          startTime: targetStart,
          endTime: targetEnd,
          deletedAt: null,
        },
      });
      if (existingShift) {
        targetShiftId = existingShift.id;
      } else {
        const newShift = await this.shiftRepository.createShift(assignment.outletId, {
          name: `Shift (${targetStart} - ${targetEnd})`,
          startTime: targetStart,
          endTime: targetEnd,
        });
        targetShiftId = newShift.id;
      }
    } else if (data.shiftId && data.shiftId !== assignment.shiftId) {
      // The new shift template must belong to the same outlet as the assignment
      const shift = await this.shiftRepository.findShiftById(assignment.outletId, data.shiftId);
      if (!shift) {
        throw new AppError('SHIFT_NOT_FOUND', 'Target shift not found', 404);
      }
      targetShiftId = shift.id;
      targetStart = shift.startTime;
      targetEnd = shift.endTime;
    }

    const targetDate = data.date ? new Date(data.date) : assignment.date;

    const leave = await findApprovedLeaveOn(assignment.employeeId, targetDate);
    if (leave) {
      throw new AppError(
        'ON_LEAVE',
        `This employee is on approved leave on ${formatLeaveDate(targetDate)} (${formatLeaveDate(leave.startDate)} to ${formatLeaveDate(leave.endDate)}).`,
        400
      );
    }

    // Check for overlaps with other shifts of this employee on targetDate (excluding this assignment)
    const existingAssignments = await this.shiftRepository.findShiftAssignmentsForEmployee(
      assignment.employeeId,
      targetDate
    );

    for (const other of existingAssignments) {
      if (other.id === assignmentId) continue;
      const exStart = other.shift.startTime;
      const exEnd = other.shift.endTime;
      if (exStart < targetEnd && exEnd > targetStart) {
        throw new AppError(
          'SHIFT_OVERLAP',
          `Shift overlaps with existing shift: ${other.shift.name} (${exStart} - ${exEnd})`,
          400
        );
      }
    }

    return this.shiftRepository.updateShiftAssignment(assignmentId, {
      shiftId: targetShiftId,
      date: targetDate,
    });
  }

  async updateShift(outletId: string, shiftId: string, data: any, businessId?: string | null) {
    const shift = await this.shiftRepository.findShiftById(outletId, shiftId, businessId);
    if (!shift) {
      throw new AppError('SHIFT_NOT_FOUND', 'Shift not found', 404);
    }
    return this.shiftRepository.updateShift(shiftId, data);
  }

  async deleteShift(outletId: string, shiftId: string, businessId?: string | null) {
    const shift = await this.shiftRepository.findShiftById(outletId, shiftId, businessId);
    if (!shift) {
      throw new AppError('SHIFT_NOT_FOUND', 'Shift not found', 404);
    }
    return this.shiftRepository.deleteShift(shiftId);
  }
}
export default ShiftService;
