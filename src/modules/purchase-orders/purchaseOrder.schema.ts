import { z } from 'zod';

export const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    orderedQuantity: z.number().positive(),
    unitCostPaise: z.number().int().positive(),
  })).min(1),
});

export const receivePOSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().uuid(),
    receivedQuantity: z.number().min(0),
    damagedQuantity: z.number().min(0).optional(), // rejected at delivery (rotten, broken, wrong item)
    batchNumber: z.string().min(1),
    expiryDate: z.string().transform((val) => new Date(val)),
  })).min(1),
});

export const closePOSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  address: z.string().min(1),
  category: z.string().optional(),
  type: z.enum(['ONLINE', 'OFFLINE']).optional(),
  password: z.string().optional(),
});

export const updateSupplierPOStatusSchema = z.object({
  status: z.enum(['PACKING', 'OUT_OF_STOCK', 'PARTIALLY_DISPATCHED', 'DISPATCHED']),
  supplierNotes: z.string().optional(),
  expectedNextDeliveryDate: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    dispatchedQuantity: z.number().min(0),
  })).optional(),
});
