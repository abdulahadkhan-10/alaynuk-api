import { z } from 'zod';

export const createFeedbackSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1),
  source: z.string().default('RECEIPT'),
});

export const createStaffQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
  category: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']),
  comment: z.string().optional(),
});
