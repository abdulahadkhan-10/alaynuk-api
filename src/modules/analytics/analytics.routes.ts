import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';

const router = Router();
const controller = new AnalyticsController();

router.use(authMiddleware);

// Only OWNER & MANAGER can access analytics
router.get('/daily-summary', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.getDailySummary);
router.get('/best-worst-sellers', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.getBestWorstSellers);
router.get('/reports', businessMiddleware, authorize('BUSINESS_OWNER', 'MANAGER'), controller.getReports);

// Outlet comparison aggregates data across outlets, so it doesn't scope to a single business ID
router.get('/outlet-comparison', authorize('BUSINESS_OWNER', 'MANAGER'), controller.getOutletComparison);

export default router;
