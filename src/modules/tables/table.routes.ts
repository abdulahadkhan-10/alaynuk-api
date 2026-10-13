import { Router } from 'express';
import { TableController } from './table.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createBulkTablesSchema, updateTableSchema } from './table.schema';

const router = Router();
const controller = new TableController();

router.get('/', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF'), controller.getTables);
router.post('/', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: createBulkTablesSchema }), controller.createBulkTables);
router.patch('/:id', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: updateTableSchema }), controller.updateTable);
router.post('/:id/regenerate-qr', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.regenerateQRToken);
router.delete('/:id', authMiddleware, businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.deleteTable);

export default router;
