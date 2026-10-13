import { EmployeeService } from '../src/modules/employees/employee.service';
import { EmployeeRepository } from '../src/modules/employees/employee.repository';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { AuthService } from '../src/modules/auth/auth.service';
import { authMiddleware } from '../src/middleware/auth.middleware';
import { generateToken, generateRefreshToken } from '../src/utils/jwt';
import { prisma } from '../src/config/prisma';
import bcrypt from 'bcrypt';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    employee: { count: jest.fn() },
    outlet: { findMany: jest.fn() },
    userOutlet: { findMany: jest.fn() },
  },
}));

jest.mock('../src/config/redis', () => ({ redisClient: { isOpen: false } }));

const OUTLET_A = '11111111-1111-1111-1111-111111111111';
const owner = { userId: 'user-owner', role: 'BUSINESS_OWNER', businessId: 'biz-1' };
const rahul = { id: 'emp-rahul', userId: 'user-rahul', role: 'STAFF', status: 'ACTIVE', outletId: OUTLET_A };

describe('Deactivated / removed employees lose access', () => {
  const service = new EmployeeService();
  let revokeSessions: jest.SpyInstance;
  let setStatusForUser: jest.SpyInstance;
  let removeOutletAccess: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(EmployeeRepository.prototype, 'findById').mockResolvedValue(rahul as any);
    jest.spyOn(EmployeeRepository.prototype, 'update').mockResolvedValue(rahul as any);
    jest.spyOn(EmployeeRepository.prototype, 'softDelete').mockResolvedValue(rahul as any);
    setStatusForUser = jest.spyOn(EmployeeRepository.prototype, 'setStatusForUser').mockResolvedValue({ count: 1 } as any);
    removeOutletAccess = jest.spyOn(EmployeeRepository.prototype, 'removeOutletAccess').mockResolvedValue({ count: 1 } as any);
    revokeSessions = jest.spyOn(AuthRepository.prototype, 'deleteUserRefreshTokens').mockResolvedValue(undefined);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-rahul', role: 'STAFF', isActive: true, businessOwner: null });
  });

  it('setting an employee INACTIVE disables their login and ends their sessions', async () => {
    (prisma.employee.count as jest.Mock).mockResolvedValue(0);

    await service.updateEmployee(OUTLET_A, 'emp-rahul', { status: 'INACTIVE' }, owner);

    expect(setStatusForUser).toHaveBeenCalledWith('user-rahul', 'INACTIVE');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-rahul' }, data: { isActive: false } });
    expect(revokeSessions).toHaveBeenCalledWith('user-rahul');
  });

  it('setting an employee back to ACTIVE re-enables their login', async () => {
    jest.spyOn(EmployeeRepository.prototype, 'findById').mockResolvedValue({ ...rahul, status: 'INACTIVE' } as any);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-rahul', role: 'STAFF', isActive: false, businessOwner: null });
    (prisma.employee.count as jest.Mock).mockResolvedValue(1);

    await service.updateEmployee(OUTLET_A, 'emp-rahul', { status: 'ACTIVE' }, owner);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-rahul' }, data: { isActive: true } });
    expect(revokeSessions).not.toHaveBeenCalled();
  });

  it('changing an employee role logs them out so the new role applies immediately', async () => {
    (prisma.employee.count as jest.Mock).mockResolvedValue(1);

    await service.updateEmployee(OUTLET_A, 'emp-rahul', { role: 'KITCHEN' }, owner);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(revokeSessions).toHaveBeenCalledWith('user-rahul');
  });

  it('removing an employee takes away outlet access and disables the login when no active role remains', async () => {
    (prisma.employee.count as jest.Mock).mockResolvedValue(0);

    await service.deleteEmployee(OUTLET_A, 'emp-rahul', owner);

    expect(removeOutletAccess).toHaveBeenCalledWith('user-rahul', OUTLET_A);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-rahul' }, data: { isActive: false } });
    expect(revokeSessions).toHaveBeenCalledWith('user-rahul');
  });

  it('never disables the original business owner account', async () => {
    jest.spyOn(EmployeeRepository.prototype, 'findById').mockResolvedValue({ ...rahul, userId: 'user-founder', role: 'BUSINESS_OWNER' } as any);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-founder', role: 'BUSINESS_OWNER', isActive: true, businessOwner: { id: 'bo-1' } });
    (prisma.employee.count as jest.Mock).mockResolvedValue(0);

    await service.updateEmployee(OUTLET_A, 'emp-founder', { status: 'INACTIVE' }, owner);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});

describe('Disabled accounts cannot sign in or stay signed in', () => {
  const authService = new AuthService();
  const disabledUser = {
    id: 'user-rahul',
    email: 'rahul@cafe.com',
    name: 'Rahul',
    role: 'STAFF',
    businessId: 'biz-1',
    isActive: false,
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects login for a deactivated account, even with the right password', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    jest.spyOn(AuthRepository.prototype, 'findUserByEmail').mockResolvedValue({ ...disabledUser, passwordHash } as any);

    await expect(authService.login('rahul@cafe.com', 'password123')).rejects.toThrow('Your account has been deactivated');
  });

  it('rejects session refresh for a deactivated account and ends its sessions', async () => {
    const refreshToken = generateRefreshToken({ id: disabledUser.id, email: disabledUser.email });
    jest.spyOn(AuthRepository.prototype, 'findRefreshToken').mockResolvedValue({
      userId: disabledUser.id,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      user: disabledUser,
    } as any);
    const revoke = jest.spyOn(AuthRepository.prototype, 'deleteUserRefreshTokens').mockResolvedValue(undefined);

    await expect(authService.refresh(refreshToken)).rejects.toThrow('Your account has been deactivated');
    expect(revoke).toHaveBeenCalledWith(disabledUser.id);
  });

  it('auth middleware blocks a still-valid access token once the account is disabled', async () => {
    const token = generateToken({ id: disabledUser.id, email: disabledUser.email, role: 'STAFF', name: 'Rahul' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: false, deletedAt: null });
    const next = jest.fn();

    await authMiddleware({ headers: { authorization: `Bearer ${token}` }, cookies: {} } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('auth middleware lets an active account through', async () => {
    const token = generateToken({ id: 'user-priya', email: 'priya@cafe.com', role: 'STAFF', name: 'Priya' });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: true, deletedAt: null });
    const req: any = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const next = jest.fn();

    await authMiddleware(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 'user-priya' });
  });
});
