import { Router } from 'express';
import { SubscriptionController } from './subscription.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { authorize } from '../../middleware/role.middleware';

const router = Router();
const controller = new SubscriptionController();

// Public / Accessible
router.get('/plans', controller.getPlans);
router.get('/validate-coupon', controller.validateCoupon);
router.post('/webhook', controller.handleWebhook);
router.post('/webhook/cashfree', controller.handleWebhook);

// Protected routes for Business Owner / Super Admin
router.use(authMiddleware);
router.use(authorize('BUSINESS_OWNER', 'SUPER_ADMIN'));

router.post('/apply-coupon', controller.applyCoupon);
router.post('/outlets/initiate', controller.initiateOutletCheckout);
router.post('/outlets/verify', controller.verifyOutletPayment);
router.get('/outlets/:outletId/status', controller.getOutletSubscriptionStatus);
router.get('/billing-history', controller.getBillingHistory);

export default router;
