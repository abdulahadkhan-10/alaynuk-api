import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { sendSuccess } from '../../utils/response';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { logger } from '../../config/logger';

// Helper to set HTTP-Only cookies
const setTokenCookies = (res: Response, token: string, refreshToken?: string, role?: string): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    domain: isProduction ? '.alaynai.com' : undefined,
  };

  const isSuperAdmin = role === 'SUPER_ADMIN';
  const cookieName = isSuperAdmin ? 'alayn_admin_token' : 'token';
  const refreshCookieName = isSuperAdmin ? 'alayn_admin_refreshToken' : 'refreshToken';

  // Set role-specific token
  res.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  if (refreshToken) {
    const refreshMaxAge = (isProduction ? 15 : 30) * 24 * 60 * 60 * 1000; // 15 days in prod, 30 days in dev
    res.cookie(refreshCookieName, refreshToken, {
      ...cookieOptions,
      maxAge: refreshMaxAge,
    });
  }
};

export class AuthController {
  private authService = new AuthService();

  register = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await this.authService.register(req.body);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const result = await this.authService.login(email, password);

      setTokenCookies(res, result.accessToken, result.refreshToken, result.user?.role);

      return sendSuccess(res, {
        message: 'Login successful',
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('[AUTH REFRESH ATTEMPT] Incoming token refresh request...');

      const portalHeader = (req.headers['x-portal'] as string)?.toLowerCase();
      const originHeader = (req.headers.origin || req.headers.referer || '') as string;
      const isAdminPortal = portalHeader === 'admin' || originHeader.includes('admin');

      let refreshToken: string | undefined;

      if (isAdminPortal) {
        refreshToken =
          req.cookies?.alayn_admin_refreshToken ||
          req.body?.refreshToken ||
          (req.headers['x-refresh-token'] as string) ||
          req.cookies?.refreshToken;
      } else {
        refreshToken =
          req.cookies?.refreshToken ||
          req.body?.refreshToken ||
          (req.headers['x-refresh-token'] as string);
      }

      if (!refreshToken) {
        logger.warn('[AUTH REFRESH FAILED] No refresh token provided in cookies, body, or headers.', {
          cookiesReceived: req.cookies ? Object.keys(req.cookies) : [],
          hasCookieHeader: !!req.headers.cookie,
        });
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'No refresh token provided',
          },
        });
      }

      const result = await this.authService.refresh(refreshToken);
      setTokenCookies(res, result.accessToken, result.refreshToken, result.user?.role);

      return sendSuccess(res, {
        message: 'Token refreshed successfully',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      });
    } catch (error: any) {
      logger.warn(`[AUTH REFRESH FAILED] Error refreshing token: ${error?.message || error}`);
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const portalHeader = (req.headers['x-portal'] as string)?.toLowerCase();
      const originHeader = (req.headers.origin || req.headers.referer || '') as string;
      const isAdminPortal = portalHeader === 'admin' || originHeader.includes('admin');

      const refreshToken = isAdminPortal
        ? (req.cookies?.alayn_admin_refreshToken || req.body?.refreshToken || (req.headers['x-refresh-token'] as string))
        : (req.cookies?.refreshToken || req.body?.refreshToken || (req.headers['x-refresh-token'] as string));

      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }

      const isProduction = process.env.NODE_ENV === 'production';
      const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax' as const,
        domain: isProduction ? '.alaynai.com' : undefined,
        path: '/',
      };

      if (isAdminPortal) {
        res.clearCookie('alayn_admin_token', cookieOptions);
        res.clearCookie('alayn_admin_refreshToken', cookieOptions);
      } else {
        res.clearCookie('token', cookieOptions);
        res.clearCookie('refreshToken', cookieOptions);
      }

      return sendSuccess(res, { message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  };

  me = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const result = await this.authService.getMe(userId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const result = await this.authService.updateProfile(userId, req.body);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  changePassword = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const { oldPassword, newPassword } = req.body;
      const result = await this.authService.changePassword(userId, oldPassword, newPassword);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const result = await this.authService.forgotPassword(email);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  verifyResetOtp = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, otp } = req.body;
      const result = await this.authService.verifyResetOtp(email, otp);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, resetToken, newPassword } = req.body;
      const result = await this.authService.resetPassword(email, resetToken, newPassword);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export default AuthController;

