import { z } from 'zod';

// SUPER_ADMIN is intentionally not assignable through employee management.
// Which of these roles a caller may actually grant is enforced in employee.permissions.ts.
const employeeRoleSchema = z.enum(['BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN']);

export const createEmployeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(10),
  role: employeeRoleSchema,
  joiningDate: z.string().transform((val) => new Date(val)),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  outletIds: z.array(z.string().uuid()).optional(),
  userId: z.string().uuid().optional(),
});

export const updateEmployeeSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional().or(z.literal('')),
  phone: z.string().min(10).optional(),
  role: employeeRoleSchema.optional(),
  joiningDate: z.string().transform((val) => new Date(val)).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  outletIds: z.array(z.string().uuid()).optional(),
  userId: z.string().uuid().optional(),
});

// Leave dates are calendar days ("YYYY-MM-DD"); any time part is ignored
const leaveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Dates must be in YYYY-MM-DD format')
  .transform((val) => new Date(`${val.slice(0, 10)}T00:00:00.000Z`));

export const createLeaveRequestSchema = z
  .object({
    // Optional: omitted = the logged-in employee. Only owners/managers may file for someone else.
    employeeId: z.string().uuid().optional(),
    startDate: leaveDateSchema,
    endDate: leaveDateSchema,
    reason: z.string().trim().min(1),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Leave end date cannot be before the start date',
    path: ['endDate'],
  });

export const updateLeaveRequestStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});
