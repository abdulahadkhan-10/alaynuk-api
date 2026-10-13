import pino from 'pino';
import { env } from './env';

let stream: any = undefined;

if (env.NODE_ENV === 'development') {
  try {
    // Dynamically require pino-pretty in development only
    const pinoPretty = require('pino-pretty');
    stream = pinoPretty({
      colorize: true,
      ignore: 'pid,hostname',
      sync: true,
    });
  } catch (err) {
    // Fall back gracefully if pino-pretty is unavailable
  }
}

export const logger = pino(
  {
    level: env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  },
  stream
);

