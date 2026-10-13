import { EmployeeService } from '../src/modules/employees/employee.service';
import { EmployeeRepository } from '../src/modules/employees/employee.repository';
import { createEmployeeSchema, updateEmployeeSchema } from '../src/modules/employees/employee.schema';
import { prisma } from '../src/config/prisma';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    outlet: { findMany: jest.fn() },
    userOutlet: { findMany: jest.fn() },
    // Login-access sync after updates (covered in account-access.test.ts); no user = nothing to sync
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('../src/config/redis', () => ({ redisClient: { isOpen: false } }));

const OUTLET_A = '11111111-1111-1111-1111-111111111111';
const OUTLET_B = '22222222-2222-2222-2222-222222222222';
const OTHER_BUSINESS_OUTLET = '33333333-3333-3333-3333-333333333333';

const owner = { userId: 'user-owner', role: 'BUSINESS_OWNER', businessId: 'biz-1' };
const manager = { userId: 'user-vikram', role: 'MANAGER', businessId: 'biz-1' };

const newEmployee = (role: string, outletIds?: string[]) => ({
  name: 'Test Person',
  email: 'test@example.com',
  password: 'secret123',
  phone: '9876543210',
  role,
  joiningDate: new Date(),
  ...(outletIds ? { outletIds } : {}),
});

describe('Employee role & outlet permissions', () => {
  const service = new EmployeeService();
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;
  let findByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    createSpy = jest.spyOn(EmployeeRepository.prototype, 'create').mockResolvedValue({ id: 'emp-new' } as any);
    updateSpy = jest.spyOn(EmployeeRepository.prototype, 'update').mockResolvedValue({ id: 'emp-x' } as any);
    deleteSpy = jest.spyOn(EmployeeRepository.prototype, 'softDelete').mockResolvedValue({ id: 'emp-x' } as any);
    findByIdSpy = jest.spyOn(EmployeeRepository.prototype, 'findById');

    // Outlets A and B belong to biz-1; the third outlet belongs to someone else
    (prisma.outlet.findMany as jest.Mock).mockImplementation(({ where }: any) =>
      where.id.in.filter((id: string) => id !== OTHER_BUSINESS_OUTLET).map((id: string) => ({ id }))
    );
    // The manager is assigned to outlet A only
    (prisma.userOutlet.findMany as jest.Mock).mockImplementation(({ where }: any) =>
      where.outletId.in.filter((id: string) => id === OUTLET_A).map((outletId: string) => ({ outletId }))
    );
  });

  describe('schema', () => {
    it('rejects SUPER_ADMIN as an employee role', () => {
      expect(createEmployeeSchema.safeParse({ ...newEmployee('SUPER_ADMIN'), joiningDate: '2026-10-07' }).success).toBe(false);
      expect(updateEmployeeSchema.safeParse({ role: 'SUPER_ADMIN' }).success).toBe(false);
    });
  });

  describe('create', () => {
    it('lets a manager hire staff into an outlet they manage', async () => {
      await service.createEmployee(OUTLET_A, newEmployee('STAFF'), manager);
      expect(createSpy).toHaveBeenCalled();
    });

    it('forbids a manager from creating a business owner', async () => {
      await expect(service.createEmployee(OUTLET_A, newEmployee('BUSINESS_OWNER'), manager)).rejects.toThrow(
        'You are not allowed to assign the BUSINESS_OWNER role.'
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('forbids a manager from creating another manager', async () => {
      await expect(service.createEmployee(OUTLET_A, newEmployee('MANAGER'), manager)).rejects.toThrow(
        'You are not allowed to assign the MANAGER role.'
      );
    });

    it('forbids a manager from adding staff to an outlet they do not manage', async () => {
      await expect(
        service.createEmployee(OUTLET_A, newEmployee('STAFF', [OUTLET_B]), manager)
      ).rejects.toThrow('Managers can only add employees to outlets they manage.');
    });

    it("forbids adding an employee to another business's outlet", async () => {
      await expect(
        service.createEmployee(OUTLET_A, newEmployee('STAFF', [OTHER_BUSINESS_OUTLET]), owner)
      ).rejects.toThrow('One or more selected outlets do not belong to your business.');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('lets an owner add a co-owner', async () => {
      await service.createEmployee(OUTLET_A, newEmployee('BUSINESS_OWNER'), owner);
      expect(createSpy).toHaveBeenCalled();
    });

    it('rejects "all outlets" as the target outlet', async () => {
      await expect(service.createEmployee('all', newEmployee('STAFF'), owner)).rejects.toThrow(
        'Please select a specific outlet for this employee.'
      );
    });
  });

  describe('update', () => {
    const vikramSelf = {
      id: 'emp-vikram',
      userId: 'user-vikram',
      role: 'MANAGER',
      status: 'ACTIVE',
      user: { outlets: [{ outletId: OUTLET_A }] },
    };

    it('forbids a manager from promoting themselves to owner', async () => {
      findByIdSpy.mockResolvedValue(vikramSelf);
      await expect(
        service.updateEmployee(OUTLET_A, 'emp-vikram', { role: 'BUSINESS_OWNER' }, manager)
      ).rejects.toThrow('You cannot change your own role, outlets or status.');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('forbids a manager from adding themselves to more outlets', async () => {
      findByIdSpy.mockResolvedValue(vikramSelf);
      await expect(
        service.updateEmployee(OUTLET_A, 'emp-vikram', { outletIds: [OUTLET_A, OUTLET_B] }, manager)
      ).rejects.toThrow('You cannot change your own role, outlets or status.');
    });

    it('lets a manager update their own phone number when role and outlets are unchanged', async () => {
      findByIdSpy.mockResolvedValue(vikramSelf);
      await service.updateEmployee(
        OUTLET_A,
        'emp-vikram',
        { phone: '9999999999', role: 'MANAGER', outletIds: [OUTLET_A] },
        manager
      );
      expect(updateSpy).toHaveBeenCalled();
    });

    it("forbids a manager from editing another manager's profile", async () => {
      findByIdSpy.mockResolvedValue({ id: 'emp-other', userId: 'user-other', role: 'MANAGER', status: 'ACTIVE' });
      await expect(
        service.updateEmployee(OUTLET_A, 'emp-other', { password: 'newpass123' }, manager)
      ).rejects.toThrow('You are not allowed to manage MANAGER accounts.');
    });

    it('forbids a manager from promoting staff to manager', async () => {
      findByIdSpy.mockResolvedValue({ id: 'emp-rahul', userId: 'user-rahul', role: 'STAFF', status: 'ACTIVE' });
      await expect(
        service.updateEmployee(OUTLET_A, 'emp-rahul', { role: 'MANAGER' }, manager)
      ).rejects.toThrow('You are not allowed to assign the MANAGER role.');
    });

    it('lets an owner promote staff to manager', async () => {
      findByIdSpy.mockResolvedValue({ id: 'emp-rahul', userId: 'user-rahul', role: 'STAFF', status: 'ACTIVE' });
      await service.updateEmployee(OUTLET_A, 'emp-rahul', { role: 'MANAGER' }, owner);
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('forbids deleting your own profile', async () => {
      findByIdSpy.mockResolvedValue({ id: 'emp-vikram', userId: 'user-vikram', role: 'MANAGER' });
      await expect(service.deleteEmployee(OUTLET_A, 'emp-vikram', manager)).rejects.toThrow(
        'You cannot delete your own employee profile.'
      );
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('forbids a manager from deleting an owner', async () => {
      findByIdSpy.mockResolvedValue({ id: 'emp-owner', userId: 'user-owner', role: 'BUSINESS_OWNER' });
      await expect(service.deleteEmployee(OUTLET_A, 'emp-owner', manager)).rejects.toThrow(
        'You are not allowed to manage BUSINESS_OWNER accounts.'
      );
    });
  });
});
