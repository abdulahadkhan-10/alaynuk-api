import { Router } from 'express';
import { PurchaseOrderController } from './purchaseOrder.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createPOSchema, receivePOSchema, closePOSchema, createSupplierSchema, updateSupplierPOStatusSchema } from './purchaseOrder.schema';

const router = Router();
const controller = new PurchaseOrderController();

router.use(authMiddleware);
router.use(businessMiddleware);

// --- Supplier Portal Routes (SUPPLIER role) ---
router.get('/portal/orders', authorize('SUPPLIER'), controller.getSupplierPortalOrders);
router.patch('/portal/orders/:id/status', authorize('SUPPLIER'), validate({ body: updateSupplierPOStatusSchema }), controller.updateSupplierPOStatus);

// --- Manager / Owner Procurement Routes ---
router.get('/suppliers', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF'), controller.getSuppliers);
router.post('/suppliers', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: createSupplierSchema }), controller.createSupplier);
router.patch('/suppliers/:id', authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateSupplier);
router.delete('/suppliers/:id', authorize('BUSINESS_OWNER', 'MANAGER'), controller.deleteSupplier);
router.get('/', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF'), controller.getPOs);
router.post('/', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: createPOSchema }), controller.createPO);
router.patch('/:id/receive', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: receivePOSchema }), controller.receivePO);
router.patch('/:id/cancel', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: closePOSchema }), controller.cancelPO);
router.patch('/:id/close', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: closePOSchema }), controller.closePO);

export default router;
