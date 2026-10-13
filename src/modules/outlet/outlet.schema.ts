import { z } from 'zod';

export const createOutletSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(3),
  city: z.string().min(2),
  state: z.string().min(2),
  country: z.string().min(2),
  couponCode: z.string().optional(),
  kitchenMode: z.enum(['KOT', 'KDS', 'HYBRID']).optional(),
});

export const updateKitchenModeSchema = z.object({
  kitchenMode: z.enum(['KOT', 'KDS', 'HYBRID']),
});

export const updateAttendanceRulesSchema = z.object({
  earlyBufferMinutes: z.number().int().min(0).max(240),
  lateGraceMinutes: z.number().int().min(0).max(240),
});

