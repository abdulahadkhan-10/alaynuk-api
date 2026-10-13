import { Router } from 'express';
import { InventoryController } from './inventory.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createItemSchema, adjustStockSchema } from './inventory.schema';

const router = Router();
const controller = new InventoryController();

router.use(authMiddleware);
router.use(businessMiddleware);

// Manage inventory items (OWNER & MANAGER)
router.get('/items', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.list);
router.post('/items', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: createItemSchema }), controller.create);
router.get('/items/:id/stock', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getStock);
router.post('/items/:id/adjust', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: adjustStockSchema }), controller.adjust);
router.get('/alerts', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getAlerts);

// Recipes (OWNER & MANAGER)
router.post('/recipes', authorize('BUSINESS_OWNER', 'MANAGER'), controller.createRecipe);

export default router;

