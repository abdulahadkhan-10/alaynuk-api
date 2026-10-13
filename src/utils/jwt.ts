import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export const generateToken = (payload: object, expiresIn: SignOptions['expiresIn'] = '15m'): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
};

export const verifyToken = (token: string): any => {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

export const generateRefreshToken = (payload: object): string => {
  const isProduction = env.NODE_ENV === 'production';
  const expiresIn = isProduction ? '15d' : '30d';
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn });
};

export const verifyRefreshToken = (token: string): any => {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};
