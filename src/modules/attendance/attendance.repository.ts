import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';

type Db = typeof prisma | Prisma.TransactionClient;

export interface NewAttendanceRecord {
  outletId: string;
  employeeId: string;
  date: Date;
  checkInTime: Date;
  status: 'PRESENT' | 'LATE';
  isLate: boolean;
  workedOnHoliday: boolean;
  workedOnClosedDay: boolean;
  extraShift: boolean;
}

export class AttendanceRepository {
  constructor(private db: Db = prisma) {}

  /**
   * Runs `fn` while holding a per-employee lock, so two punches for the same employee (a double tap,
   * a network retry) can't both pass the "already clocked in?" check and create duplicate records.
   */
  async withEmployeePunchLock<T>(employeeId: string, fn: (repo: AttendanceRepository) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${employeeId}))`;
      return fn(new AttendanceRepository(tx));
    });
  }

  async findEmployee(outletId: string, id: string, businessId?: string | null) {
    const isAll = !outletId || outletId === 'all';
    // In "all outlets" mode, still restrict the lookup to the caller's own business
    const where = isAll
      ? { id, deletedAt: null, ...(businessId ? { outlet: { businessId } } : {}) }
      : { id, outletId, deletedAt: null };
    return this.db.employee.findFirst({
      where,
    });
  }

  async findEmployeeByUserId(userId: string) {
    return this.db.employee.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
    });
  }

  /** The employee's current shift, i.e. clocked in and not yet clocked out (missed clock-outs don't count). */
  async findOpenAttendance(employeeId: string) {
    return this.db.attendance.findFirst({
      where: {
        employeeId,
        checkOutTime: null,
        missedClockOut: false,
      },
    });
  }

  /** All punches of an employee on a calendar day (split shifts produce several). */
  async findAttendancesOnDate(employeeId: string, date: Date) {
    return this.db.attendance.findMany({
      where: { employeeId, date },
      orderBy: { checkInTime: 'asc' },
    });
  }

  async findAttendanceById(id: string) {
    return this.db.attendance.findUnique({
      where: { id },
      include: { employee: { include: { outlet: { select: { businessId: true } } } } },
    });
  }

  /** Other punches of the employee that overlap the given time range (used to validate manager corrections). */
  async findOverlappingAttendance(employeeId: string, excludeId: string, from: Date, to: Date) {
    return this.db.attendance.findFirst({
      where: {
        employeeId,
        id: { not: excludeId },
        checkInTime: { lt: to },
        OR: [{ checkOutTime: { gt: from } }, { checkOutTime: null, missedClockOut: false }],
      },
    });
  }

  async createAttendance(data: NewAttendanceRecord) {
    return this.db.attendance.create({ data });
  }

  async updateAttendance(id: string, data: Record<string, unknown>) {
    return this.db.attendance.update({
      where: { id },
      data,
    });
  }

  async markMissedClockOut(id: string) {
    return this.db.attendance.update({
      where: { id },
      data: { missedClockOut: true },
    });
  }

  /** Flags every still-open punch that started before the cutoff as a missed clock-out (no end time, no hours). */
  async markStaleOpenRecordsMissed(cutoff: Date) {
    return this.db.attendance.updateMany({
      where: { checkOutTime: null, missedClockOut: false, checkInTime: { lt: cutoff } },
      data: { missedClockOut: true },
    });
  }

  /** The employee came back the same day (split shift / break), so earlier "left early" flags no longer apply. */
  async clearLeftEarlyOnDate(employeeId: string, date: Date) {
    await this.db.attendance.updateMany({
      where: { employeeId, date, leftEarly: true, isLate: true },
      data: { leftEarly: false, status: 'LATE' },
    });
    await this.db.attendance.updateMany({
      where: { employeeId, date, leftEarly: true, isLate: false },
      data: { leftEarly: false, status: 'PRESENT' },
    });
  }

  async findAttendanceLogs(outletId: string, businessId?: string) {
    const isAll = !outletId || outletId === 'all';
    const where: any = isAll ? {} : { outletId };
    if (isAll && businessId) {
      where.employee = { outlet: { businessId } };
    }
    return this.db.attendance.findMany({
      where,
      include: {
        employee: true,
      },
      orderBy: { checkInTime: 'desc' },
    });
  }

  async findOutletHoliday(outletId: string, date: Date) {
    return this.db.outletHoliday.findUnique({
      where: {
        outletId_date: {
          outletId,
          date,
        },
      },
    });
  }

  async findOutlet(outletId: string) {
    return this.db.outlet.findUnique({
      where: { id: outletId },
    });
  }

  async findEmployeeRoster(employeeId: string, dayOfWeek: any) {
    return this.db.employeeRoster.findUnique({
      where: {
        employeeId_dayOfWeek: {
          employeeId,
          dayOfWeek,
        },
      },
      include: {
        shift: true,
      },
    });
  }

  async findShiftAssignment(employeeId: string, date: Date) {
    return this.db.shiftAssignment.findFirst({
      where: { employeeId, date },
      include: { shift: true },
    });
  }
}
export default AttendanceRepository;
