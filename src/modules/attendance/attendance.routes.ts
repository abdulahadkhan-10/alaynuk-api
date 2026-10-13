import { Router } from 'express';
import { AttendanceController } from './attendance.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { validate } from '../../middleware/validate.middleware';
import { authorize } from '../../middleware/role.middleware';
import { checkInSchema, checkOutSchema, correctAttendanceSchema } from './attendance.schema';

const router = Router();
const controller = new AttendanceController();

// Suppliers have no attendance; everyone else may punch (Staff/Kitchen only for themselves — enforced in the service)
const PUNCH_ROLES = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'] as const;

router.use(authMiddleware);
router.use(businessMiddleware);

router.get('/', controller.listLogs);
router.post('/check-in', authorize(...PUNCH_ROLES), validate({ body: checkInSchema }), controller.checkIn);
router.post('/check-out', authorize(...PUNCH_ROLES), validate({ body: checkOutSchema }), controller.checkOut);
// Correct a punch (e.g. missed clock-out). Managers only for Staff/Kitchen, never their own — enforced in the service.
router.patch('/:id', authorize('SUPER_ADMIN', 'BUSINESS_OWNER', 'MANAGER'), validate({ body: correctAttendanceSchema }), controller.correct);

export default router;
