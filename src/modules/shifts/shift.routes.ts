import { Router } from 'express';
import { ShiftController } from './shift.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';
import { authorize } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createShiftSchema,
  assignShiftSchema,
  createSwapSchema,
  updateSwapStatusSchema,
  respondSwapSchema,
  updateAssignmentSchema,
  updateShiftSchema,
} from './shift.schema';

const router = Router();
const controller = new ShiftController();

router.use(authMiddleware);
router.use(businessMiddleware);

// Only OWNER & MANAGER can configure shifts, but all roles can view shifts
router.get('/', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.list);
router.post('/', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: createShiftSchema }), controller.create);

// Assignments (Specific path before :id wildcard)
router.patch('/assignments/:assignmentId', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: updateAssignmentSchema }), controller.updateAssignment);
router.delete('/assignments/:assignmentId', authorize('BUSINESS_OWNER', 'MANAGER'), controller.deleteAssignment);

// Shift Templates Update & Delete
router.patch('/:id', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: updateShiftSchema }), controller.updateShiftTemplate);
router.delete('/:id', authorize('BUSINESS_OWNER', 'MANAGER'), controller.deleteShiftTemplate);

// Assign Shift (supports optional replaceExisting: true)
router.post('/:id/assign', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: assignShiftSchema }), controller.assign);

// Swaps
// Flow: employee offers their own shift → colleague accepts (/respond) → manager approves. Rules enforced in the service.
router.post('/swaps', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), validate({ body: createSwapSchema }), controller.requestSwap);
router.patch('/swaps/:id/respond', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), validate({ body: respondSwapSchema }), controller.respondToSwap);
router.patch('/swaps/:id', authorize('BUSINESS_OWNER', 'MANAGER'), validate({ body: updateSwapStatusSchema }), controller.updateSwapStatus);

// Rosters (Weekly Templates)
router.get('/rosters/outlet', authorize('BUSINESS_OWNER', 'MANAGER'), controller.getOutletRosters);
router.get('/rosters/employee/:employeeId', authorize('BUSINESS_OWNER', 'MANAGER', 'STAFF', 'KITCHEN'), controller.getEmployeeRoster);
router.post('/rosters', authorize('BUSINESS_OWNER', 'MANAGER'), controller.setWeeklyRoster);

export default router;
