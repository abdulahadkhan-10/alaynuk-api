import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { AppError } from '../../utils/AppError';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { logger } from '../../config/logger';
import { redisClient } from '../../config/redis';
import { emailService } from '../../utils/email.service';

// In-memory fallback cache for OTPs if Redis is unavailable
const memoryOtpStore = new Map<string, { value: string; expiresAt: number }>();

const cacheSet = async (key: string, value: string, ttlSeconds: number) => {
  if (redisClient.isOpen) {
    try {
      await redisClient.setEx(key, ttlSeconds, value);
      return;
    } catch (err) {
      logger.error(`[OTP Cache] Redis setEx failed, using fallback: ${err}`);
    }
  }
  memoryOtpStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
};

const cacheGet = async (key: string): Promise<string | null> => {
  if (redisClient.isOpen) {
    try {
      const val = await redisClient.get(key);
      if (val) return val;
    } catch (err) {
      logger.error(`[OTP Cache] Redis get failed, trying fallback: ${err}`);
    }
  }
  const entry = memoryOtpStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryOtpStore.delete(key);
    return null;
  }
  return entry.value;
};

const cacheDel = async (key: string) => {
  if (redisClient.isOpen) {
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.error(`[OTP Cache] Redis del failed: ${err}`);
    }
  }
  memoryOtpStore.delete(key);
};


export class AuthService {
  private authRepository = new AuthRepository();

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateUserAccessToken(user: { id: string; email: string; role: string; name: string; businessId?: string | null; phoneNo?: string | null }) {
    return generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      businessId: user.businessId,
      phoneNo: user.phoneNo,
    });
  }

  private generateUserRefreshToken(user: { id: string; email: string; role: string; name: string; businessId?: string | null; phoneNo?: string | null }) {
    return generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      businessId: user.businessId,
      phoneNo: user.phoneNo,
      jti: crypto.randomUUID(),
    });
  }

  async register(data: {
    user: {
      name: string;
      email: string;
      password: string;
      phoneNo: string;
    };
    business: {
      name: string;
      locationsCount: string;
      businessType: string;
      contactDetail: string;
    };
    couponCode?: string;
  }) {

    // Check if email already exists
    const existingUser = await this.authRepository.findUserByEmail(
      data.user.email
    );

    if (existingUser) {
      throw new AppError(
        "EMAIL_ALREADY_EXISTS",
        "Email already exists.",
        409
      );
    }

    // Validate coupon code if supplied
    let normalizedCoupon: string | undefined = undefined;
    if (data.couponCode && data.couponCode.trim()) {
      normalizedCoupon = data.couponCode.trim().toUpperCase();
      if (normalizedCoupon !== "FIRST25") {
        throw new AppError(
          "INVALID_COUPON",
          'Invalid coupon code. Use "FIRST25" for free access until December 2026.',
          400
        );
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.user.password, 10);

    // Create Owner
    const { user, business, businessOwner, subscription } =
      await this.authRepository.registerOwner({
        user: {
          name: data.user.name,
          email: data.user.email,
          passwordHash,
          phoneNo: data.user.phoneNo,
        },

        business: {
          name: data.business.name,
          locationsCount: data.business.locationsCount,
          businessType: data.business.businessType,
          contactDetail: data.business.contactDetail,
        },

        couponCode: normalizedCoupon,
      });

    return {
      message: normalizedCoupon === "FIRST25"
        ? "Registration successful with FIRST25 VIP access until December 2026! Please login to continue."
        : "Registration successful. Please login to continue.",

      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },

      business: {
        id: business.id,
        name: business.name,
      },

      businessOwner: {
        id: businessOwner.id,
        userId: businessOwner.userId,
        businessId: businessOwner.businessId,
      },

      couponApplied: normalizedCoupon === "FIRST25",
      subscription: subscription ? {
        status: subscription.status,
        planId: subscription.planId,
        currentPeriodEnd: subscription.currentPeriodEnd,
      } : null,
    };
  }

  async login(email: string, password: string) {
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User does not exist. Please sign up.', 404);
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect password. Please try again.', 401);
    }

    if (user.isActive === false) {
      throw new AppError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact your manager.', 403);
    }

    const accessToken = this.generateUserAccessToken(user);
    const rawRefreshToken = this.generateUserRefreshToken(user);
    const refreshHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await this.authRepository.createRefreshToken(user.id, refreshHash, expiresAt);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        business: user.business,
        businessOwner: user.businessOwner,
      },
    };
  }

  async refresh(refreshToken: string) {
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      logger.warn('[AUTH REFRESH FAILED] JWT verifyRefreshToken failed: Token signature is invalid or expired.');
      throw new AppError('INVALID_TOKEN', 'Refresh token JWT verification failed or expired', 401);
    }

    const refreshHash = this.hashToken(refreshToken);
    const tokenRecord = await this.authRepository.findRefreshToken(refreshHash);

    if (!tokenRecord) {
      logger.warn('[AUTH REFRESH FAILED] Token hash not found in database records (revoked or reused).', {
        userId: decoded.id,
        email: decoded.email,
        refreshHashPrefix: refreshHash.substring(0, 10),
      });
      throw new AppError('INVALID_TOKEN', 'Refresh token is invalid or has been revoked', 401);
    }

    if (new Date() > tokenRecord.expiresAt) {
      logger.warn('[AUTH REFRESH FAILED] Refresh token record in database has expired.', {
        userId: tokenRecord.userId,
        email: tokenRecord.user?.email,
        expiresAt: tokenRecord.expiresAt,
        now: new Date().toISOString(),
      });
      await this.authRepository.deleteRefreshToken(refreshHash);
      throw new AppError('EXPIRED_TOKEN', 'Refresh token has expired', 401);
    }

    const user = tokenRecord.user;
    if (user.isActive === false) {
      await this.authRepository.deleteUserRefreshTokens(user.id);
      throw new AppError('ACCOUNT_DISABLED', 'Your account has been deactivated. Please contact your manager.', 403);
    }

    const accessToken = this.generateUserAccessToken(user);
    const newRawRefreshToken = this.generateUserRefreshToken(user);
    const newRefreshHash = this.hashToken(newRawRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Delete old refresh token, save new one
    await this.authRepository.deleteRefreshToken(refreshHash);
    await this.authRepository.createRefreshToken(user.id, newRefreshHash, expiresAt);

    logger.info(`[AUTH REFRESH SUCCESS] Token refreshed successfully for user "${user.name}" (${user.email}) | ID: ${user.id} | Role: ${user.role}`);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        business: user.business,
        businessOwner: user.businessOwner,
      },
    };
  }

  async logout(refreshToken: string) {
    const refreshHash = this.hashToken(refreshToken);
    await this.authRepository.deleteRefreshToken(refreshHash);
  }

  async getMe(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phoneNo: user.phoneNo,
      createdAt: user.createdAt,
      business: user.business,
      businessOwner: user.businessOwner,
    };
  }

  async updateProfile(userId: string, data: { name?: string; phoneNo?: string }) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const updatedUser = await this.authRepository.updateUser(userId, {
      ...(data.name ? { name: data.name } : {}),
      ...(data.phoneNo ? { phoneNo: data.phoneNo } : {}),
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      phoneNo: updatedUser.phoneNo,
      createdAt: updatedUser.createdAt,
      business: updatedUser.business,
      businessOwner: updatedUser.businessOwner,
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
    }

    if (!newPassword || newPassword.length < 6) {
      throw new AppError('INVALID_PASSWORD', 'New password must be at least 6 characters', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.authRepository.updatePassword(userId, passwordHash);

    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    // Check 60-second cooldown
    const cooldownKey = `otp_cooldown:${normalizedEmail}`;
    const isCooldownActive = await cacheGet(cooldownKey);
    if (isCooldownActive) {
      throw new AppError(
        'COOLDOWN_ACTIVE',
        'A verification code was recently sent. Please wait 60 seconds before requesting another.',
        429
      );
    }

    // Check if user exists
    const user = await this.authRepository.findUserByEmail(normalizedEmail);

    // If user does not exist, return generic success to prevent email enumeration
    if (!user) {
      // Artificial delay (100-200ms) to prevent timing analysis attacks
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        message: 'If an account exists with this email address, a 6-digit verification code has been sent.',
      };
    }

    // Generate secure 6-digit OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    // Store in cache (10 minutes TTL, max 5 attempts)
    const otpData = JSON.stringify({
      otpHash,
      attempts: 0,
      maxAttempts: 5,
      userId: user.id,
      email: normalizedEmail,
      createdAt: Date.now(),
    });

    const otpKey = `pwd_reset_otp:${normalizedEmail}`;
    await cacheSet(otpKey, otpData, 600); // 10 minutes

    // Set 60-second resend cooldown
    await cacheSet(cooldownKey, 'active', 60);

    // Dispatch email
    await emailService.sendPasswordResetOtp({
      to: user.email,
      otp: rawOtp,
      recipientName: user.name,
    });

    return {
      message: 'If an account exists with this email address, a 6-digit verification code has been sent.',
    };
  }

  async verifyResetOtp(email: string, otp: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const otpKey = `pwd_reset_otp:${normalizedEmail}`;

    const cachedDataStr = await cacheGet(otpKey);
    if (!cachedDataStr) {
      throw new AppError(
        'INVALID_OTP',
        'Verification code has expired or is invalid. Please request a new code.',
        400
      );
    }

    const data = JSON.parse(cachedDataStr);

    // Check attempt threshold
    if (data.attempts >= data.maxAttempts) {
      await cacheDel(otpKey);
      throw new AppError(
        'MAX_ATTEMPTS_EXCEEDED',
        'Maximum verification attempts exceeded. Please request a new verification code.',
        429
      );
    }

    // Compare hash
    const submittedHash = crypto.createHash('sha256').update(otp.trim()).digest('hex');
    if (submittedHash !== data.otpHash) {
      data.attempts += 1;
      const remainingAttempts = data.maxAttempts - data.attempts;

      if (remainingAttempts <= 0) {
        await cacheDel(otpKey);
        throw new AppError(
          'MAX_ATTEMPTS_EXCEEDED',
          'Incorrect code. Verification limit reached. Please request a new code.',
          400
        );
      } else {
        // Update attempt count in cache with remaining TTL
        const remainingTtlSeconds = Math.max(1, Math.floor((data.createdAt + 600000 - Date.now()) / 1000));
        await cacheSet(otpKey, JSON.stringify(data), remainingTtlSeconds);
        throw new AppError(
          'INVALID_OTP',
          `Incorrect verification code. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.`,
          400
        );
      }
    }

    // OTP is valid! Remove OTP and issue a single-use reset token valid for 10 minutes
    await cacheDel(otpKey);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenKey = `pwd_reset_token:${resetToken}`;
    await cacheSet(
      tokenKey,
      JSON.stringify({
        userId: data.userId,
        email: normalizedEmail,
      }),
      600 // 10 minutes
    );

    return {
      message: 'Code verified successfully.',
      resetToken,
    };
  }

  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const tokenKey = `pwd_reset_token:${resetToken.trim()}`;

    const cachedTokenStr = await cacheGet(tokenKey);
    if (!cachedTokenStr) {
      throw new AppError(
        'INVALID_RESET_TOKEN',
        'Password reset session has expired or is invalid. Please request a new code.',
        400
      );
    }

    const tokenData = JSON.parse(cachedTokenStr);
    if (tokenData.email !== normalizedEmail) {
      throw new AppError('UNAUTHORIZED', 'Invalid reset session for this email address.', 403);
    }

    if (!newPassword || newPassword.length < 6) {
      throw new AppError('INVALID_PASSWORD', 'New password must be at least 6 characters long.', 400);
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update in database
    await this.authRepository.updatePassword(tokenData.userId, passwordHash);

    // Invalidate all active user sessions / refresh tokens across all devices
    await this.authRepository.deleteUserRefreshTokens(tokenData.userId);

    // Revoke the reset token
    await cacheDel(tokenKey);

    logger.info(`[AuthService] Password reset successfully completed for user ${tokenData.userId}`);

    return {
      message: 'Password has been reset successfully. You can now log in with your new password.',
    };
  }
}
