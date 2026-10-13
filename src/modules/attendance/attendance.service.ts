import { AttendanceRepository } from './attendance.repository';
import { AppError } from '../../utils/AppError';
import { assertCanManageEmployee } from '../employees/employee.permissions';
import { findApprovedLeaveOn } from '../employees/leave.helpers';

// All outlets currently operate in India (IST, UTC+5:30). Attendance times are
// always taken from the server clock and converted with this offset — never
// from the client, which staff could tamper with.
const OUTLET_UTC_OFFSET_MINUTES = 330;
const DEFAULT_EARLY_BUFFER_MINUTES = 30;
const DEFAULT_LATE_GRACE_MINUTES = 30;
const EARLY_DEPARTURE_THRESHOLD_MINUTES = 15;

// A punch still open after this long is treated as a forgotten clock-out. It is NOT given an invented
// end time: it is flagged "missed clock-out" and counts 0 hours until a manager enters the real time.
// Long enough that genuine double shifts / overtime past closing are never cut off.
const STALE_OPEN_PUNCH_HOURS = 20;

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// Roles allowed to clock in/out on behalf of another employee (e.g. shared terminal, fixing a missed punch)
const PROXY_PUNCH_ROLES = ['BUSINESS_OWNER', 'MANAGER', 'SUPER_ADMIN'];

export interface AttendanceActor {
  userId?: string;
  role?: string;
  businessId?: string | null;
}

export interface AttendancePunchInput {
  employeeId?: string;
  latitude?: number;
  longitude?: number;
  // Set after the employee confirms "Clock in anyway?" on a holiday / closed day / weekly off
  confirmOffDay?: boolean;
}

export interface AttendanceCorrectionInput {
  checkInTime?: Date;
  checkOutTime?: Date;
  reason: string;
}

function summaryStatus(isLate: boolean, leftEarly: boolean): 'PRESENT' | 'LATE' | 'EARLY_DEPARTURE' {
  // The single legacy status column keeps the most important fact; the separate flags keep both.
  if (isLate) return 'LATE';
  if (leftEarly) return 'EARLY_DEPARTURE';
  return 'PRESENT';
}

export class AttendanceService {
  private attendanceRepository = new AttendanceRepository();

  private toOutletLocalTime(now: Date) {
    const localNow = new Date(now.getTime() + OUTLET_UTC_OFFSET_MINUTES * 60 * 1000);
    return {
      year: localNow.getUTCFullYear(),
      month: localNow.getUTCMonth(),
      dateNum: localNow.getUTCDate(),
      dayIdx: localNow.getUTCDay(),
      hours: localNow.getUTCHours(),
      minutes: localNow.getUTCMinutes(),
    };
  }

  private isStale(checkInTime: Date, now: Date) {
    return now.getTime() - checkInTime.getTime() > STALE_OPEN_PUNCH_HOURS * 60 * 60 * 1000;
  }

  /** The shift an employee is scheduled for on a date: a date-specific assignment wins, otherwise the weekly roster. */
  private async findScheduledShift(employeeId: string, date: Date, repo = this.attendanceRepository) {
    const assignment = await repo.findShiftAssignment(employeeId, date);
    if (assignment?.shift) {
      return { shift: assignment.shift, roster: null };
    }
    // `date` is UTC midnight of the local calendar day, so its UTC weekday is the local weekday
    const roster = await repo.findEmployeeRoster(employeeId, DAY_NAMES[date.getUTCDay()]);
    return { shift: roster?.shift ?? null, roster };
  }

  /**
   * Decides whose attendance is being punched. Staff/Kitchen can only punch for
   * themselves; only owners/managers may pass another employee's ID.
   */
  private async resolveTargetEmployee(outletId: string, actor: AttendanceActor, requestedEmployeeId?: string) {
    const self = actor.userId ? await this.attendanceRepository.findEmployeeByUserId(actor.userId) : null;
    const isProxyPunch = !!requestedEmployeeId && requestedEmployeeId !== self?.id;

    if (isProxyPunch) {
      if (!actor.role || !PROXY_PUNCH_ROLES.includes(actor.role)) {
        throw new AppError('FORBIDDEN', 'You can only clock in or out for yourself.', 403);
      }
      const employee = await this.attendanceRepository.findEmployee(outletId, requestedEmployeeId!, actor.businessId);
      if (!employee) {
        throw new AppError('EMPLOYEE_NOT_FOUND', 'Employee not found', 404);
      }
      return employee;
    }

    if (!self) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 'Employee profile not found for logged in user', 404);
    }
    return self;
  }

  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const phi1 = lat1 * Math.PI / 180; // φ, λ in radians
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private assertWithinGeofence(outlet: any, lat: number | undefined, lng: number | undefined, action: 'in' | 'out') {
    if (outlet && outlet.latitude && outlet.longitude) {
      if (lat === undefined || lng === undefined) {
        throw new AppError('LOCATION_REQUIRED', `Location access is required to punch ${action} at this outlet.`, 400);
      }
      const distance = this.getDistance(lat, lng, outlet.latitude, outlet.longitude);
      const maxRadius = outlet.geofenceRadius || 100;
      if (distance > maxRadius) {
        throw new AppError('OUTSIDE_GEOFENCE', `You are ${Math.round(distance)} meters away. You must be within ${maxRadius} meters of the outlet to punch ${action}.`, 400);
      }
    }
  }

  async checkIn(
    outletId: string,
    actor: AttendanceActor,
    input: AttendancePunchInput = {},
    now: Date = new Date()
  ) {
    const employee = await this.resolveTargetEmployee(outletId, actor, input.employeeId);
    const targetEmployeeId = employee.id;
    outletId = employee.outletId;

    if (employee.status !== 'ACTIVE') {
      throw new AppError('INACTIVE_EMPLOYEE', 'Inactive employees cannot check in', 400);
    }

    // Serialised per employee: a double tap or retried request waits here, then sees the first punch as open
    return this.attendanceRepository.withEmployeePunchLock(targetEmployeeId, (repo) =>
      this.createPunch(repo, outletId, targetEmployeeId, input, now)
    );
  }

  private async createPunch(
    repo: AttendanceRepository,
    outletId: string,
    targetEmployeeId: string,
    input: AttendancePunchInput,
    now: Date
  ) {
    const { latitude: lat, longitude: lng } = input;
    const {
      year: localYear,
      month: localMonth,
      dateNum: localDateNum,
      dayIdx: localDayIdx,
      hours: localHours,
      minutes: localMinutes,
    } = this.toOutletLocalTime(now);

    // Standardized UTC midnight date representing this calendar day in local outlet time
    const date = new Date(Date.UTC(localYear, localMonth, localDateNum));

    const openRecord = await repo.findOpenAttendance(targetEmployeeId);
    if (openRecord) {
      const fromEarlierDay = openRecord.date.getTime() < date.getTime();
      if (fromEarlierDay || this.isStale(openRecord.checkInTime, now)) {
        // Forgot to clock out last time: flag it for the manager (0 hours, no invented end time) and carry on
        await repo.markMissedClockOut(openRecord.id);
      } else {
        throw new AppError('ALREADY_CHECKED_IN', 'You are already clocked in. Clock out first.', 400);
      }
    }

    // Split shifts / breaks: several punches per day are allowed. Late/early rules apply to the first one only.
    const earlierToday = await repo.findAttendancesOnDate(targetEmployeeId, date);
    const isFirstPunchToday = earlierToday.length === 0;

    const outlet = await repo.findOutlet(outletId);
    this.assertWithinGeofence(outlet, lat, lng, 'in');

    // Holidays, closed days and weekly offs no longer block clock-in: the employee confirms, and the
    // punch is tagged so the manager can see (and pay) it correctly.
    const currentDayName = DAY_NAMES[localDayIdx];
    const holiday = await repo.findOutletHoliday(outletId, date);

    let workedOnClosedDay = false;
    if (outlet?.operatingDays) {
      try {
        const operatingDaysArr: string[] = JSON.parse(outlet.operatingDays);
        workedOnClosedDay = !operatingDaysArr.includes(currentDayName);
      } catch {
        // Malformed operating days: treat the outlet as open
      }
    }

    const { shift, roster } = await this.findScheduledShift(targetEmployeeId, date, repo);
    const onWeeklyOff = !shift && !!roster && roster.shiftId === null;
    const approvedLeave = await findApprovedLeaveOn(targetEmployeeId, date);
    // Working on a weekly off or during approved leave is an extra (unplanned) shift
    const extraShift = onWeeklyOff || !!approvedLeave;

    const offDayReasons: string[] = [];
    if (holiday) offDayReasons.push(`Today is an outlet holiday (${holiday.name}).`);
    if (workedOnClosedDay) offDayReasons.push(`The outlet is normally closed on ${currentDayName.toLowerCase()}s.`);
    if (approvedLeave) offDayReasons.push('You are on approved leave today.');
    else if (onWeeklyOff) offDayReasons.push('Today is your scheduled weekly off.');

    if (offDayReasons.length > 0 && isFirstPunchToday && !input.confirmOffDay) {
      throw new AppError('CLOCK_IN_CONFIRMATION_REQUIRED', `${offDayReasons.join(' ')} Clock in anyway?`, 409);
    }

    let isLate = false;
    if (shift && isFirstPunchToday) {
      const { startTime, name: shiftName } = shift;
      const [startH, startM] = startTime.split(':').map(Number);

      // Rules are configured per outlet by the owner/manager (Settings), never supplied by the client
      const earlyBufferMinutes = outlet?.earlyBufferMinutes ?? DEFAULT_EARLY_BUFFER_MINUTES;
      const lateGraceMinutes = outlet?.lateGraceMinutes ?? DEFAULT_LATE_GRACE_MINUTES;

      const currentMins = localHours * 60 + localMinutes;
      const shiftStartMins = startH * 60 + startM;
      const earliestAllowedMins = shiftStartMins - earlyBufferMinutes;
      const lateThresholdMins = shiftStartMins + lateGraceMinutes;

      if (currentMins < earliestAllowedMins) {
        const earlyHour = Math.floor(((earliestAllowedMins % 1440) + 1440) % 1440 / 60);
        const earlyMin = Math.floor(((earliestAllowedMins % 1440) + 1440) % 1440 % 60);
        const period = earlyHour >= 12 ? 'PM' : 'AM';
        const displayH = earlyHour % 12 === 0 ? 12 : (earlyHour > 12 ? earlyHour - 12 : earlyHour);
        const earliestStr = `${displayH}:${String(earlyMin).padStart(2, '0')} ${period}`;

        throw new AppError(
          'TOO_EARLY',
          `Cannot clock in yet: Your ${shiftName} starts at ${startTime}. Early clock-in opens ${earlyBufferMinutes} minutes prior (at ${earliestStr}).`,
          400
        );
      }

      isLate = currentMins > lateThresholdMins;
    }

    if (!isFirstPunchToday) {
      // Back from a break / second half of a split shift: the earlier clock-out wasn't "leaving early"
      await repo.clearLeftEarlyOnDate(targetEmployeeId, date);
    }

    return repo.createAttendance({
      outletId,
      employeeId: targetEmployeeId,
      date,
      checkInTime: now,
      status: isLate ? 'LATE' : 'PRESENT',
      isLate,
      workedOnHoliday: !!holiday,
      workedOnClosedDay,
      extraShift,
    });
  }

  async checkOut(
    outletId: string,
    actor: AttendanceActor,
    input: AttendancePunchInput = {},
    now: Date = new Date()
  ) {
    const { latitude: lat, longitude: lng } = input;
    const employee = await this.resolveTargetEmployee(outletId, actor, input.employeeId);
    const targetEmployeeId = employee.id;
    outletId = employee.outletId;

    const openRecord = await this.attendanceRepository.findOpenAttendance(targetEmployeeId);
    if (!openRecord) {
      throw new AppError('NO_OPEN_ATTENDANCE', 'No open attendance record found for this employee', 400);
    }

    if (this.isStale(openRecord.checkInTime, now)) {
      // Clocking out a day later would record an invented 20+ hour shift
      await this.attendanceRepository.markMissedClockOut(openRecord.id);
      throw new AppError(
        'MISSED_CLOCK_OUT',
        'Your last clock-in was too long ago and has been marked as a missed clock-out. Please ask your manager to enter the correct time.',
        400
      );
    }

    const outlet = await this.attendanceRepository.findOutlet(outletId);
    this.assertWithinGeofence(outlet, lat, lng, 'out');

    if (now <= openRecord.checkInTime) {
      throw new AppError('INVALID_CHECKOUT_TIME', 'Check-out time must be after check-in time', 400);
    }

    const { hours: localHours, minutes: localMinutes } = this.toOutletLocalTime(now);

    let leftEarly = false;
    const { shift } = await this.findScheduledShift(targetEmployeeId, openRecord.date);

    if (shift) {
      const { endTime, startTime } = shift;
      const [endH, endM] = endTime.split(':').map(Number);
      const [startH, startM] = startTime.split(':').map(Number);

      let shiftEndMins = endH * 60 + endM;
      const shiftStartMins = startH * 60 + startM;
      let currentMins = localHours * 60 + localMinutes;

      // Handle night shifts crossing midnight (e.g. 22:00 to 02:00)
      if (shiftEndMins < shiftStartMins) {
        shiftEndMins += 24 * 60;
        if (currentMins < shiftStartMins) {
          currentMins += 24 * 60;
        }
      }

      leftEarly = currentMins < shiftEndMins - EARLY_DEPARTURE_THRESHOLD_MINUTES;
    }

    // Late and left-early are stored separately, so leaving early never erases a late arrival
    return this.attendanceRepository.updateAttendance(openRecord.id, {
      checkOutTime: now,
      leftEarly,
      status: summaryStatus(openRecord.isLate, leftEarly),
    });
  }

  /**
   * Manager/owner correction of a punch (e.g. entering the real time for a missed clock-out).
   * Keeps an audit trail: who changed it, when and why.
   */
  async correctAttendance(
    outletId: string,
    actor: AttendanceActor,
    attendanceId: string,
    input: AttendanceCorrectionInput,
    now: Date = new Date()
  ) {
    const record = await this.attendanceRepository.findAttendanceById(attendanceId);
    const isAll = !outletId || outletId === 'all';
    const inScope =
      !!record &&
      (isAll
        ? actor.role === 'SUPER_ADMIN' || record.employee.outlet.businessId === actor.businessId
        : record.outletId === outletId);
    if (!record || !inScope) {
      throw new AppError('ATTENDANCE_NOT_FOUND', 'Attendance record not found', 404);
    }

    if (record.employee.userId && record.employee.userId === actor.userId) {
      throw new AppError('FORBIDDEN', 'You cannot edit your own attendance. Ask the business owner.', 403);
    }
    // Managers may only correct Staff and Kitchen attendance
    assertCanManageEmployee({ userId: actor.userId || '', role: actor.role || '', businessId: actor.businessId }, record.employee);

    const newIn = input.checkInTime ?? record.checkInTime;
    const newOut = input.checkOutTime ?? record.checkOutTime;

    if (newIn > now || (newOut && newOut > now)) {
      throw new AppError('INVALID_TIME', 'Attendance times cannot be in the future.', 400);
    }
    if (newOut && newOut <= newIn) {
      throw new AppError('INVALID_TIME', 'Clock-out time must be after clock-in time.', 400);
    }
    if (newOut && newOut.getTime() - newIn.getTime() > 24 * 60 * 60 * 1000) {
      throw new AppError('INVALID_TIME', 'A single shift cannot be longer than 24 hours.', 400);
    }
    if (newOut) {
      const overlap = await this.attendanceRepository.findOverlappingAttendance(record.employeeId, record.id, newIn, newOut);
      if (overlap) {
        throw new AppError('OVERLAPPING_ATTENDANCE', 'These times overlap with another punch of the same employee.', 400);
      }
    }

    return this.attendanceRepository.updateAttendance(record.id, {
      checkInTime: newIn,
      checkOutTime: newOut,
      // Once a real end time is entered, the record counts again
      missedClockOut: newOut ? false : record.missedClockOut,
      editedById: actor.userId,
      editReason: input.reason.trim(),
      editedAt: now,
    });
  }

  async getAttendanceLogs(outletId: string, businessId?: string, now: Date = new Date()) {
    // Surface forgotten clock-outs as soon as anyone looks at attendance (no background scheduler needed)
    await this.attendanceRepository.markStaleOpenRecordsMissed(
      new Date(now.getTime() - STALE_OPEN_PUNCH_HOURS * 60 * 60 * 1000)
    );
    return this.attendanceRepository.findAttendanceLogs(outletId, businessId);
  }
}
export default AttendanceService;
