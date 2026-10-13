import { z } from 'zod';

export const createOrderSchema = z.object({
  tableNumber: z.union([z.number(), z.string()]).optional(),
  tableNo: z.union([z.number(), z.string()]).optional(),
  source: z.enum(['TABLE', 'COUNTER', 'QR', 'DELIVERY']).optional(),
  orderSource: z.enum(['TABLE', 'COUNTER', 'QR', 'DELIVERY']).optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
  })).min(1),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED', 'DISPATCHED', 'COMPLETED', 'CANCELLED']),
  comment: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'UPI']).optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
});

// Remove (waive = true) or restore the voluntary service charge on an open dine-in bill
export const serviceChargeWaiverSchema = z.object({
  waive: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

export const createPaymentSchema = z.object({
  amountPaise: z.number().int().positive(),
  method: z.enum(['UPI', 'CARD', 'CASH']),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED']).default('CONFIRMED'),
});
