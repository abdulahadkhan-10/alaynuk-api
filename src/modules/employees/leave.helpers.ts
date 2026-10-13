import { prisma } from '../../config/prisma';

/**
 * The approved leave (if any) that covers a calendar date for an employee.
 * Dates are stored as UTC midnight of the calendar day (Postgres DATE), like shift and attendance dates.
 */
export async function findApprovedLeaveOn(employeeId: string, date: Date) {
  return prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: 'APPROVED',
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
}

export function formatLeaveDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Outlets operate in India (IST, UTC+5:30); "today" is the outlet's local calendar date at UTC midnight
const OUTLET_UTC_OFFSET_MINUTES = 330;

export function outletToday(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + OUTLET_UTC_OFFSET_MINUTES * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}
