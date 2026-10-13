import { Router } from 'express';
import { aiController } from './ai.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { businessMiddleware } from '../../middleware/business.middleware';

const router = Router();

router.use(authMiddleware);

router.post('/assistant', businessMiddleware, aiController.queryAssistant);

export default router;
