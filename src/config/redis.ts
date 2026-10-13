import { createClient } from 'redis';
import { env } from './env';
import { logger } from './logger';

export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null, // Required by BullMQ
};

export const redisClient = createClient({
  url: `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.on('connect', () => logger.info('Redis Client Connected'));

// Auto-connect if not testing
if (env.NODE_ENV !== 'test') {
  redisClient.connect().catch((err) => logger.error('Redis auto-connect failed', err));
}
