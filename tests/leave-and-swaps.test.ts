import { EmployeeService } from '../src/modules/employees/employee.service';
import { ShiftService } from '../src/modules/shifts/shift.service';
import { createLeaveRequestSchema } from '../src/modules/employees/employee.schema';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => {
  const prismaMock: any = {
    employee: { findFirst: jest.fn(), findMany: jest.fn() },
    leaveRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    shift: { findFirst: jest.fn() },
    shiftAssignment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    shiftSwapRequest: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    outlet: { findUnique: jest.fn() },
  };
  prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
  return { prisma: prismaMock };
});

jest.mock('../src/config/redis', () => ({ redisClient: { isOpen: false } }));
jest.mock('../src/modules/notifications/notification.service', () => ({
  NotificationService: {
    notifyLeaveRequested: jest.fn().mockResolvedValue(undefined),
    notifyLeaveStatusChanged: jest.fn().mockResolvedValue(undefined),
  },
}));

const OUTLET = 'outlet-1';
const NOW = new Date('2026-10-08T06:00:00.000Z'); // 8 Oct 2026, 11:30 IST
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const owner = { userId: 'user-owner', role: 'BUSINESS_OWNER', businessId: 'biz-1' };
const vikram = { userId: 'user-vikram', role: 'MANAGER', businessId: 'biz-1' };
const rahul = { userId: 'user-rahul', role: 'STAFF', businessId: 'biz-1' };

const EMP = {
  rahul: { id: 'emp-rahul', userId: 'user-rahul', name: 'Rahul', role: 'STAFF', outletId: OUTLET, status: 'ACTIVE' },
  priya: { id: 'emp-priya', userId: 'user-priya', name: 'Priya', role: 'STAFF', outletId: OUTLET, status: 'ACTIVE' },
  vikram: { id: 'emp-vikram', userId: 'user-vikram', name: 'Vikram', role: 'MANAGER', outletId: OUTLET, status: 'ACTIVE' },
  anita: { id: 'emp-anita', userId: 'user-anita', name: 'Anita', role: 'MANAGER', outletId: OUTLET, status: 'ACTIVE' },
};
const byId = (id: string) => Object.values(EMP).find((e) => e.id === id) || null;
const byUserId = (userId: string) => Object.values(EMP).find((e) => e.userId === userId) || null;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.employee.findFirst as jest.Mock).mockImplementation(({ where }: any) =>
    where.id ? byId(where.id) : where.userId ? byUserId(where.userId) : null
  );
  (prisma.employee.findMany as jest.Mock).mockImplementation(({ where }: any) => where.id.in.map(byId));
  (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.leaveRequest.create as jest.Mock).mockImplementation(({ data }: any) => ({ id: 'leave-new', ...data }));
  (prisma.leaveRequest.update as jest.Mock).mockImplementation(({ where, data }: any) => ({ id: where.id, outletId: OUTLET, ...data }));
  (prisma.shiftAssignment.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
  (prisma.shiftSwapRequest.create as jest.Mock).mockImplementation(({ data }: any) => ({ id: 'swap-new', status: 'REQUESTED', ...data }));
  (prisma.shiftSwapRequest.update as jest.Mock).mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));
});

describe('Leave requests', () => {
  const service = new EmployeeService();
  const leave = (overrides: any = {}) => ({ startDate: day('2026-10-20'), endDate: day('2026-10-22'), reason: 'Wedding', ...overrides });

  describe('A4 — who a request is for', () => {
    it('files leave for the logged-in employee when no employee is given', async () => {
      const result: any = await service.createLeaveRequest(OUTLET, leave(), rahul, NOW);
      expect(result.employeeId).toBe('emp-rahul');
    });

    it('forbids staff from filing leave for a colleague', async () => {
      await expect(service.createLeaveRequest(OUTLET, leave({ employeeId: 'emp-priya' }), rahul, NOW)).rejects.toThrow(
        'You can only request leave for yourself.'
      );
    });

    it('lets a manager file leave on behalf of their staff', async () => {
      const result: any = await service.createLeaveRequest(OUTLET, leave({ employeeId: 'emp-priya' }), vikram, NOW);
      expect(result.employeeId).toBe('emp-priya');
    });

    it('only returns their own requests to staff', async () => {
      (prisma.leaveRequest.findMany as jest.Mock).mockResolvedValue([]);
      await service.getLeaveRequests(OUTLET, rahul);
      expect((prisma.leaveRequest.findMany as jest.Mock).mock.calls[0][0].where.employee).toEqual({ userId: 'user-rahul' });
    });
  });

  describe('A1 — managers can apply, owners decide manager leave', () => {
    it('lets a manager apply for their own leave', async () => {
      const result: any = await service.createLeaveRequest(OUTLET, leave(), vikram, NOW);
      expect(result.employeeId).toBe('emp-vikram');
    });

    it('forbids approving your own leave', async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'leave-1', status: 'REQUESTED', employee: EMP.vikram, employeeId: 'emp-vikram', startDate: day('2026-10-20'), endDate: day('2026-10-22') });
      await expect(service.updateLeaveRequestStatus(OUTLET, 'leave-1', 'APPROVED', vikram)).rejects.toThrow(
        'You cannot approve or reject your own leave.'
      );
    });

    it("forbids a manager from deciding another manager's leave, but the owner can", async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'leave-1', status: 'REQUESTED', employee: EMP.anita, employeeId: 'emp-anita', startDate: day('2026-10-20'), endDate: day('2026-10-22') });
      await expect(service.updateLeaveRequestStatus(OUTLET, 'leave-1', 'APPROVED', vikram)).rejects.toThrow(
        'You are not allowed to manage MANAGER accounts.'
      );
      const result: any = await service.updateLeaveRequestStatus(OUTLET, 'leave-1', 'APPROVED', owner);
      expect(result.status).toBe('APPROVED');
    });
  });

  describe('A3 — date checks', () => {
    it('rejects an end date before the start date', async () => {
      await expect(
        service.createLeaveRequest(OUTLET, leave({ startDate: day('2026-10-22'), endDate: day('2026-10-20') }), rahul, NOW)
      ).rejects.toThrow('Leave end date cannot be before the start date.');
      expect(
        createLeaveRequestSchema.safeParse({ startDate: '2026-10-22', endDate: '2026-10-20', reason: 'x' }).success
      ).toBe(false);
    });

    it('rejects leave starting in the past', async () => {
      await expect(
        service.createLeaveRequest(OUTLET, leave({ startDate: day('2026-10-07'), endDate: day('2026-10-09') }), rahul, NOW)
      ).rejects.toThrow('Cannot apply for leave on past dates.');
    });

    it('allows leave starting today', async () => {
      const result: any = await service.createLeaveRequest(OUTLET, leave({ startDate: day('2026-10-08'), endDate: day('2026-10-08') }), rahul, NOW);
      expect(result.id).toBe('leave-new');
    });

    it('rejects a request overlapping an existing pending or approved one', async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ status: 'APPROVED', startDate: day('2026-10-21'), endDate: day('2026-10-25') });
      await expect(service.createLeaveRequest(OUTLET, leave(), rahul, NOW)).rejects.toThrow(
        'You already have an approved leave request from 2026-10-21 to 2026-10-25.'
      );
    });
  });

  describe('A2 — approved leave changes the schedule', () => {
    it('removes shifts assigned inside the leave period when approved', async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'leave-1', status: 'REQUESTED', employee: EMP.priya, employeeId: 'emp-priya', startDate: day('2026-10-17'), endDate: day('2026-10-19') });
      (prisma.shiftAssignment.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      const result: any = await service.updateLeaveRequestStatus(OUTLET, 'leave-1', 'APPROVED', vikram);

      expect(prisma.shiftAssignment.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-priya', date: { gte: day('2026-10-17'), lte: day('2026-10-19') } },
      });
      expect(result.removedShiftAssignments).toBe(2);
    });

    it('does not touch shifts when a leave is rejected', async () => {
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ id: 'leave-1', status: 'REQUESTED', employee: EMP.priya, employeeId: 'emp-priya', startDate: day('2026-10-17'), endDate: day('2026-10-19') });
      await service.updateLeaveRequestStatus(OUTLET, 'leave-1', 'REJECTED', vikram);
      expect(prisma.shiftAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks assigning a shift on a day the employee is on approved leave', async () => {
      (prisma.shift.findFirst as jest.Mock).mockResolvedValue({ id: 'shift-1', name: 'Morning', startTime: '10:00', endTime: '18:00', outletId: OUTLET });
      (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ status: 'APPROVED', startDate: day('2026-10-17'), endDate: day('2026-10-19') });

      await expect(new ShiftService().assignShift(OUTLET, 'shift-1', 'emp-priya', day('2026-10-18'))).rejects.toThrow(
        'Priya is on approved leave on 2026-10-18 (2026-10-17 to 2026-10-19).'
      );
    });
  });
});

describe('Shift swaps (B)', () => {
  const service = new ShiftService();
  const swapInput = (overrides: any = {}) => ({
    fromEmployeeId: 'emp-rahul',
    toEmployeeId: 'emp-priya',
    shiftId: 'shift-1',
    date: day('2026-10-18'),
    ...overrides,
  });
  const existingSwap = (status: string, overrides: any = {}) => ({
    id: 'swap-1',
    status,
    outletId: OUTLET,
    fromEmployeeId: 'emp-rahul',
    toEmployeeId: 'emp-priya',
    shiftId: 'shift-1',
    date: day('2026-10-18'),
    shift: { startTime: '10:00', endTime: '18:00' },
    ...overrides,
  });

  beforeEach(() => {
    (prisma.shiftAssignment.findUnique as jest.Mock).mockResolvedValue({ id: 'asg-1' });
    (prisma.shiftAssignment.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('lets staff offer their own shift', async () => {
    const result: any = await service.createSwapRequest(OUTLET, swapInput(), rahul);
    expect(result.status).toBe('REQUESTED');
  });

  it("forbids staff from offering a colleague's shift", async () => {
    await expect(service.createSwapRequest(OUTLET, swapInput({ fromEmployeeId: 'emp-priya', toEmployeeId: 'emp-rahul' }), rahul)).rejects.toThrow(
      'You can only offer your own shift for a swap.'
    );
  });

  it('refuses a swap to someone on approved leave that day', async () => {
    (prisma.leaveRequest.findFirst as jest.Mock).mockResolvedValue({ status: 'APPROVED', startDate: day('2026-10-17'), endDate: day('2026-10-19') });
    await expect(service.createSwapRequest(OUTLET, swapInput(), rahul)).rejects.toThrow('Priya is on approved leave on 2026-10-18.');
  });

  it('only the colleague taking the shift can accept it', async () => {
    (prisma.shiftSwapRequest.findFirst as jest.Mock).mockResolvedValue(existingSwap('REQUESTED'));
    await expect(service.respondToSwap(OUTLET, 'swap-1', true, rahul)).rejects.toThrow(
      'Only the colleague being asked to take the shift can respond.'
    );
    const result: any = await service.respondToSwap(OUTLET, 'swap-1', true, { userId: 'user-priya', role: 'STAFF', businessId: 'biz-1' });
    expect(result.status).toBe('ACCEPTED');
  });

  it('a manager cannot approve before the colleague accepts', async () => {
    (prisma.shiftSwapRequest.findFirst as jest.Mock).mockResolvedValue(existingSwap('REQUESTED'));
    await expect(service.updateSwapStatus(OUTLET, 'swap-1', 'APPROVED', vikram)).rejects.toMatchObject({ code: 'SWAP_NOT_ACCEPTED' });
  });

  it('moves the shift once the colleague accepted and the manager approves', async () => {
    (prisma.shiftSwapRequest.findFirst as jest.Mock).mockResolvedValue(existingSwap('ACCEPTED'));
    const result: any = await service.updateSwapStatus(OUTLET, 'swap-1', 'APPROVED', vikram);
    expect(prisma.shiftAssignment.delete).toHaveBeenCalledWith({ where: { id: 'asg-1' } });
    expect(prisma.shiftAssignment.create).toHaveBeenCalledWith({
      data: { outletId: OUTLET, employeeId: 'emp-priya', shiftId: 'shift-1', date: day('2026-10-18') },
    });
    expect(result.status).toBe('APPROVED');
  });

  it("forbids a manager from deciding a swap that involves another manager's shift", async () => {
    (prisma.shiftSwapRequest.findFirst as jest.Mock).mockResolvedValue(existingSwap('ACCEPTED', { fromEmployeeId: 'emp-anita' }));
    await expect(service.updateSwapStatus(OUTLET, 'swap-1', 'APPROVED', vikram)).rejects.toThrow(
      'You are not allowed to manage MANAGER accounts.'
    );
  });
});
