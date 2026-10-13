import { z } from 'zod';

export const createCouponSchema = z.object({
  code: z
    .string({ required_error: 'Coupon code is required' })
    .min(2, 'Code must be at least 2 characters')
    .max(30, 'Code cannot exceed 30 characters')
    .transform((val) => val.trim().toUpperCase())
    .refine((val) => /^[A-Z0-9_-]+$/.test(val), {
      message: 'Code can only contain letters, numbers, hyphens, and underscores',
    }),
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT'], {
    required_error: 'Discount type is required',
  }),
  discountValue: z
    .number({ required_error: 'Discount value is required' })
    .positive('Discount value must be greater than zero')
    .refine((val) => val <= 1000000, {
      message: 'Discount value exceeds platform limit',
    }),
  isActive: z.boolean().optional().default(true),
  expiresAt: z
    .string()
    .datetime({ message: 'Expiry must be a valid ISO datetime' })
    .nullable()
    .optional(),
  usageLimit: z
    .number()
    .int('Usage limit must be an integer')
    .positive('Usage limit must be at least 1')
    .nullable()
    .optional(),
}).refine(
  (data) => {
    if (data.discountType === 'PERCENTAGE' && data.discountValue > 100) {
      return false;
    }
    return true;
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
);

export const updateCouponSchema = z.object({
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']).optional(),
  discountValue: z
    .number()
    .positive('Discount value must be greater than zero')
    .optional(),
  isActive: z.boolean().optional(),
  expiresAt: z
    .string()
    .datetime({ message: 'Expiry must be a valid ISO datetime' })
    .nullable()
    .optional(),
  usageLimit: z
    .number()
    .int('Usage limit must be an integer')
    .positive('Usage limit must be at least 1')
    .nullable()
    .optional(),
}).refine(
  (data) => {
    if (data.discountType === 'PERCENTAGE' && data.discountValue && data.discountValue > 100) {
      return false;
    }
    return true;
  },
  {
    message: 'Percentage discount cannot exceed 100%',
    path: ['discountValue'],
  }
);

export const getCouponsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  status: z.enum(['ALL', 'ACTIVE', 'DISABLED', 'EXPIRED']).optional().default('ALL'),
  search: z.string().optional(),
});

export const getOutletsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().optional(),
});
