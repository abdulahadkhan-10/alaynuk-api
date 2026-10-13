import { z } from 'zod';

// Note: kept as plain ZodObject (no .refine) so it's compatible with
// the validate middleware which expects AnyZodObject.
// The "at least one table" constraint is enforced in the service layer.
export const createBulkTablesSchema = z.object({
  count: z.number().int().min(1).optional(),
  acCount: z.number().int().min(0).optional(),
  nonAcCount: z.number().int().min(0).optional(),
});

export const updateTableSchema = z.object({
  status: z.enum(['AVAILABLE', 'OCCUPIED']).optional(),
  assignedStaffId: z.string().nullable().optional(),
});
