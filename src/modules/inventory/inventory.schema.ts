import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  reorderThreshold: z.number().nonnegative(),
  unitCostPaise: z.number().int().positive(),
  currentStock: z.number().nonnegative().optional(),
  outletId: z.string().optional(),
});

export const adjustStockSchema = z.object({
  change: z.number(), // Positive or negative
  reason: z.enum(['PURCHASE', 'WASTE', 'SALE', 'ADJUSTMENT']).default('ADJUSTMENT'),
});
