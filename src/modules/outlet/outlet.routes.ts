import { Router } from 'express';
import { OutletController } from './outlet.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createOutletSchema, updateAttendanceRulesSchema } from './outlet.schema';
import { authorize } from '../../middleware/role.middleware';

import { businessMiddleware } from '../../middleware/business.middleware';

const router = Router();
const controller = new OutletController();

router.use(authMiddleware);

router.post('/', authorize('BUSINESS_OWNER', 'SUPER_ADMIN'), validate({ body: createOutletSchema }), controller.create);
router.get('/', controller.list);
router.delete('/:id', authorize('BUSINESS_OWNER', 'SUPER_ADMIN'), controller.deleteOutlet);

// Outlet Holidays & Operating Days (requires businessMiddleware for outletId context)
router.get('/holidays', businessMiddleware, controller.getHolidays);
router.post('/holidays', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.createHoliday);
router.delete('/holidays/:id', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.deleteHoliday);
router.patch('/operating-days', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateOperatingDays);
router.patch('/tax-rates', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateTaxRates);
router.patch('/receipt-details', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateReceiptDetails);
router.patch('/kitchen-mode', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateKitchenMode);
router.patch('/attendance-rules', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: updateAttendanceRulesSchema }), controller.updateAttendanceRules);
router.patch('/location',businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.updateLocation);
router.post('/resolve-map-link', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.resolveMapLink);

export default router;
