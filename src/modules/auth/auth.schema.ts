import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});


export const registerSchema = z.object({
  user: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    phoneNo: z.string().min(10),
  }),

  business: z.object({
    name: z.string().min(2),
    locationsCount: z.string().min(1),
    businessType: z.string().min(2),
    contactDetail: z.string().min(10),
  }),

  couponCode: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const verifyResetOtpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  otp: z.string().length(6, 'Verification code must be exactly 6 digits'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  resetToken: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters long'),
});