import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => {
  const client: any = {
    $executeRaw: jest.fn(),
    employee: { findFirst: jest.fn() },
    attendance: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    outletHoliday: { findUnique: jest.fn() },
    outlet: { findUnique: jest.fn() },
    employeeRoster: { findUnique: jest.fn() },
    shiftAssignment: { findFirst: jest.fn() },
    leaveRequest: { findFirst: jest.fn() },
  };
  // Interactive transactions run the callback against the same mocked client
  client.$transaction = jest.fn((fn: any) => fn(client));
  return { prisma: client };
});

// Times are IST (UTC+5:30). Helper: build a Date from an IST wall-clock time on 12 Oct 2026 (a Monday).
const ist = (hhmm: string, day = 12) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, day, h, m) - 330 * 60 * 1000);
};
const DAY_12 = new Date(Date.UTC(2026, 9, 12));
const DAY_11 = new Date(Date.UTC(2026, 9, 11));

const rahul = { userId: 'user-rahul', role: 'STAFF' };
const vikram = { userId: 'user-vikram', role: 'MANAGER', businessId: 'biz-1' };
const owner = { userId: 'user-owner', role: 'BUSINESS_OWNER', businessId: 'biz-1' };

const morningShift = { name: 'Morning', startTime: '10:00', endTime: '18:00' };

describe('Attendance rules for restaurants', () => {
  const service = new AttendanceService();

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.employee.findFirst as jest.Mock).mockResolvedValue({ id: 'emp-rahul', outletId: 'outlet-1', status: 'ACTIVE' });
    (prisma.attendance.findFirst as jest.Mock).mockResolvedValue(null); // not clocked in
    (prisma.attendance.findMany as jest.Mock).mockResolvedValue([]); // no punches today
    (prisma.attendance.create as jest.Mock).mockImplementation(({ data }: any) => ({ id: 'att-new', ...data }));
    (prisma.attendance.update as jest.Mock).mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));
    (prisma.attendance.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.outletHoliday.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.outlet.findUnique as jest.Mock).mockResolvedValue({ id: 'outlet-1', lateGraceMinutes: 15, earlyBufferMinutes: 30 });
    (prisma.employeeRoster.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.shiftAssignment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue(null); // not on leave
  });

  describe('Problem 1 & 5 — holidays, closed days and weekly offs ask instead of blocking', () => {
    it('asks for confirmation on an outlet holiday', async () => {
      (prisma.outletHoliday.findUnique as jest.Mock).mockResolvedValue({ name: 'Diwali' });
      await expect(service.checkIn('outlet-1', rahul, {}, ist('10:00'))).rejects.toMatchObject({
        code: 'CLOCK_IN_CONFIRMATION_REQUIRED',
        statusCode: 409,
      });
    });

    it('clocks in on a holiday after confirmation and tags the punch', async () => {
      (prisma.outletHoliday.findUnique as jest.Mock).mockResolvedValue({ name: 'Diwali' });
      const result: any = await service.checkIn('outlet-1', rahul, { confirmOffDay: true }, ist('10:00'));
      expect(result.workedOnHoliday).toBe(true);
    });

    it('tags work on a non-operating day after confirmation', async () => {
      (prisma.outlet.findUnique as jest.Mock).mockResolvedValue({ id: 'outlet-1', operatingDays: JSON.stringify(['TUESDAY']) });
      await expect(service.checkIn('outlet-1', rahul, {}, ist('10:00'))).rejects.toMatchObject({ code: 'CLOCK_IN_CONFIRMATION_REQUIRED' });
      const result: any = await service.checkIn('outlet-1', rahul, { confirmOffDay: true }, ist('10:00'));
      expect(result.workedOnClosedDay).toBe(true);
    });

    it('asks before clocking in during approved leave and tags it as an extra shift', async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'leave-1', status: 'APPROVED' });
      await expect(service.checkIn('outlet-1', rahul, {}, ist('10:00'))).rejects.toThrow('You are on approved leave today.');
      const result: any = await service.checkIn('outlet-1', rahul, { confirmOffDay: true }, ist('10:00'));
      expect(result.extraShift).toBe(true);
    });

    it('lets staff cover on their weekly off as a tagged extra shift', async () => {
      (prisma.employeeRoster.findUnique as jest.Mock).mockResolvedValue({ shiftId: null, shift: null });
      await expect(service.checkIn('outlet-1', rahul, {}, ist('10:00'))).rejects.toMatchObject({ code: 'CLOCK_IN_CONFIRMATION_REQUIRED' });
      const result: any = await service.checkIn('outlet-1', rahul, { confirmOffDay: true }, ist('10:00'));
      expect(result.extraShift).toBe(true);
    });
  });

  describe('Problem 2 — split shifts', () => {
    it('allows a second clock-in on the same day and clears the earlier "left early" flag', async () => {
      (prisma.attendance.findMany as jest.Mock).mockResolvedValue([{ id: 'att-morning', checkOutTime: ist('15:00') }]);
      (prisma.shiftAssignment.findFirst as jest.Mock).mockResolvedValue({ shift: morningShift });

      const result: any = await service.checkIn('outlet-1', rahul, {}, ist('18:00'));

      expect(result.id).toBe('att-new');
      // Late rules only apply to the first punch of the day
      expect(result.isLate).toBe(false);
      expect(prisma.attendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ employeeId: 'emp-rahul', date: DAY_12, leftEarly: true }) })
      );
    });

    it('still refuses a clock-in while already clocked in', async () => {
      (prisma.attendance.findFirst as jest.Mock).mockResolvedValue({ id: 'att-open', date: DAY_12, checkInTime: ist('10:00') });
      await expect(service.checkIn('outlet-1', rahul, {}, ist('11:00'))).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' });
    });

    it('takes a per-employee lock before checking for an open punch, so a double tap cannot create two', async () => {
      await service.checkIn('outlet-1', rahul, {}, ist('10:00'));
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [sql, employeeId] = (prisma.$executeRaw as jest.Mock).mock.calls[0];
      expect(sql.join('?')).toContain('pg_advisory_xact_lock');
      expect(employeeId).toBe('emp-rahul');
      const lockOrder = (prisma.$executeRaw as jest.Mock).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan((prisma.attendance.findFirst as jest.Mock).mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan((prisma.attendance.create as jest.Mock).mock.invocationCallOrder[0]);
    });
  });

  describe('Problem 3 — forgotten clock-out', () => {
    it("flags yesterday's open punch as missed (no invented end time) and lets today's clock-in through", async () => {
      (prisma.attendance.findFirst as jest.Mock).mockResolvedValue({ id: 'att-friday', date: DAY_11, checkInTime: ist('09:00', 11) });

      const result: any = await service.checkIn('outlet-1', rahul, {}, ist('09:05'));

      expect(prisma.attendance.update).toHaveBeenCalledWith({ where: { id: 'att-friday' }, data: { missedClockOut: true } });
      const missedUpdate = (prisma.attendance.update as jest.Mock).mock.calls[0][0].data;
      expect(missedUpdate.checkOutTime).toBeUndefined();
      expect(result.id).toBe('att-new');
    });

    it('does not cut off genuine overtime: a long shift on the same day can still clock out', async () => {
      (prisma.attendance.findFirst as jest.Mock).mockResolvedValue({ id: 'att-open', date: DAY_12, checkInTime: ist('09:00'), isLate: false });
      const result: any = await service.checkOut('outlet-1', rahul, {}, ist('23:30'));
      expect(result.checkOutTime).toEqual(ist('23:30'));
    });

    it('refuses to clock out a punch that has been open for over 20 hours and flags it as missed', async () => {
      (prisma.attendance.findFirst as jest.Mock).mockResolvedValue({ id: 'att-old', date: DAY_11, checkInTime: ist('09:00', 11), isLate: false });
      await expect(service.checkOut('outlet-1', rahul, {}, ist('10:00'))).rejects.toMatchObject({ code: 'MISSED_CLOCK_OUT' });
      expect(prisma.attendance.update).toHaveBeenCalledWith({ where: { id: 'att-old' }, data: { missedClockOut: true } });
    });

    it('flags stale open punches when attendance logs are viewed', async () => {
      (prisma.attendance.findMany as jest.Mock).mockResolvedValue([]);
      await service.getAttendanceLogs('outlet-1', 'biz-1', ist('12:00'));
      const call = (prisma.attendance.updateMany as jest.Mock).mock.calls[0][0];
      expect(call.data).toEqual({ missedClockOut: true });
      expect(call.where.checkInTime.lt).toEqual(new Date(ist('12:00').getTime() - 20 * 60 * 60 * 1000));
    });

    describe('manager correction', () => {
      const missedRecord = {
        id: 'att-friday',
        outletId: 'outlet-1',
        employeeId: 'emp-priya',
        checkInTime: ist('09:00', 11),
        checkOutTime: null,
        missedClockOut: true,
        employee: { userId: 'user-priya', role: 'STAFF', outlet: { businessId: 'biz-1' } },
      };

      it('enters the real clock-out time with an audit trail and counts the hours again', async () => {
        (prisma.attendance.findUnique as jest.Mock).mockResolvedValue(missedRecord);

        const result: any = await service.correctAttendance(
          'outlet-1',
          vikram,
          'att-friday',
          { checkOutTime: ist('18:00', 11), reason: 'Left at 6, confirmed with shift lead' },
          ist('09:00')
        );

        expect(result.checkOutTime).toEqual(ist('18:00', 11));
        expect(result.missedClockOut).toBe(false);
        expect(result.editedById).toBe('user-vikram');
        expect(result.editReason).toBe('Left at 6, confirmed with shift lead');
      });

      it('forbids editing your own attendance', async () => {
        (prisma.attendance.findUnique as jest.Mock).mockResolvedValue({
          ...missedRecord,
          employee: { userId: 'user-vikram', role: 'MANAGER', outlet: { businessId: 'biz-1' } },
        });
        await expect(
          service.correctAttendance('outlet-1', vikram, 'att-friday', { checkOutTime: ist('18:00', 11), reason: 'fix' }, ist('09:00'))
        ).rejects.toThrow('You cannot edit your own attendance');
      });

      it("forbids a manager from editing another manager's attendance", async () => {
        (prisma.attendance.findUnique as jest.Mock).mockResolvedValue({
          ...missedRecord,
          employee: { userId: 'user-other', role: 'MANAGER', outlet: { businessId: 'biz-1' } },
        });
        await expect(
          service.correctAttendance('outlet-1', vikram, 'att-friday', { checkOutTime: ist('18:00', 11), reason: 'fix' }, ist('09:00'))
        ).rejects.toThrow('You are not allowed to manage MANAGER accounts.');
      });

      it('rejects a clock-out before the clock-in', async () => {
        (prisma.attendance.findUnique as jest.Mock).mockResolvedValue(missedRecord);
        await expect(
          service.correctAttendance('outlet-1', owner, 'att-friday', { checkOutTime: ist('08:00', 11), reason: 'typo' }, ist('09:00'))
        ).rejects.toThrow('Clock-out time must be after clock-in time.');
      });

      it("rejects records from another outlet", async () => {
        (prisma.attendance.findUnique as jest.Mock).mockResolvedValue({ ...missedRecord, outletId: 'outlet-2' });
        await expect(
          service.correctAttendance('outlet-1', owner, 'att-friday', { checkOutTime: ist('18:00', 11), reason: 'fix' }, ist('09:00'))
        ).rejects.toMatchObject({ code: 'ATTENDANCE_NOT_FOUND' });
      });
    });
  });

  describe('Problem 4 — late marking with the weekly roster', () => {
    it('marks LATE using the weekly roster when there is no date-specific shift', async () => {
      (prisma.employeeRoster.findUnique as jest.Mock).mockResolvedValue({ shiftId: 'shift-morning', shift: morningShift });
      // 10:45 for a 10:00 shift with 15 min grace
      const result: any = await service.checkIn('outlet-1', rahul, {}, ist('10:45'));
      expect(result.isLate).toBe(true);
      expect(result.status).toBe('LATE');
    });

    it('prefers a date-specific shift over the weekly roster', async () => {
      (prisma.shiftAssignment.findFirst as jest.Mock).mockResolvedValue({ shift: { name: 'Evening', startTime: '16:00', endTime: '23:00' } });
      (prisma.employeeRoster.findUnique as jest.Mock).mockResolvedValue({ shiftId: 'shift-morning', shift: morningShift });
      const result: any = await service.checkIn('outlet-1', rahul, {}, ist('15:50'));
      expect(result.isLate).toBe(false);
    });
  });

  describe('Problem 6 — late is not erased by leaving early', () => {
    it('keeps both flags when someone arrives late and leaves early', async () => {
      (prisma.attendance.findFirst as jest.Mock).mockResolvedValue({ id: 'att-1', date: DAY_12, checkInTime: ist('10:45'), isLate: true });
      (prisma.employeeRoster.findUnique as jest.Mock).mockResolvedValue({ shiftId: 'shift-morning', shift: morningShift });

      const result: any = await service.checkOut('outlet-1', rahul, {}, ist('16:00'));

      expect(result.leftEarly).toBe(true);
      expect(result.status).toBe('LATE'); // summary keeps the late arrival
    });
  });
});
