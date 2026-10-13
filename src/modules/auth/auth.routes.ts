import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from './auth.controller';
import { validate } from '../../middleware/validate.middleware';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
} from './auth.schema';
import authMiddleware from '../../middleware/auth.middleware';

const router = Router();
const controller = new AuthController();

// Rate limiter for forgot-password requests (5 per 15 mins per IP)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many password reset requests. Please try again after 15 minutes.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', validate({ body: loginSchema }), controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);
router.post(
    "/register",
    validate({ body: registerSchema }),
    controller.register
);
router.get('/me', authMiddleware, controller.me);
router.patch('/profile', authMiddleware, controller.updateProfile);
router.post('/change-password', authMiddleware, controller.changePassword);

// Public OTP-based password reset routes
router.post('/forgot-password', forgotPasswordLimiter, validate({ body: forgotPasswordSchema }), controller.forgotPassword);
router.post('/verify-reset-otp', validate({ body: verifyResetOtpSchema }), controller.verifyResetOtp);
router.post('/reset-password', validate({ body: resetPasswordSchema }), controller.resetPassword);

export default router;

