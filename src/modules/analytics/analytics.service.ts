import { AnalyticsRepository } from './analytics.repository';
import { redisClient } from '../../config/redis';
import { logger } from '../../config/logger';

export class AnalyticsService {
  private analyticsRepository = new AnalyticsRepository();
  private CACHE_KEY = 'outlet_comparison_cache';
  private CACHE_EXPIRY = 300; // 5 minutes in seconds

  async getDailySummary(outletId: string, startDateStr?: string, endDateStr?: string) {
    const end = endDateStr ? new Date(endDateStr) : new Date();
    const start = startDateStr ? new Date(startDateStr) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // default 30 days
    return this.analyticsRepository.getDailySummaries(outletId, start, end);
  }

  async getBestWorstSellers(outletId: string) {
    return this.analyticsRepository.getBestWorstSellers(outletId);
  }

  /**
   * Branch comparison for ONE business (optionally limited to specific outlets, e.g. a manager's).
   * The cache key includes that scope so one business's figures are never served to another.
   */
  async getOutletComparison(scope: { businessId?: string | null; outletIds?: string[]; isSuperAdmin?: boolean }) {
    if (!scope.businessId && !scope.isSuperAdmin) {
      return [];
    }
    const cacheKey = `${this.CACHE_KEY}:${scope.businessId || 'platform'}:${
      scope.outletIds ? [...scope.outletIds].sort().join(',') || 'none' : 'all'
    }`;

    try {
      if (redisClient.isOpen) {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          logger.info('Serving outlet comparison from Redis cache');
          return JSON.parse(cachedData);
        }
      }
    } catch (error) {
      logger.error('Redis cache fetch failed, querying database directly:', error);
    }

    // Query database as fallback
    const comparison = await this.analyticsRepository.getOutletComparison(scope.businessId, scope.outletIds);

    try {
      if (redisClient.isOpen) {
        await redisClient.setEx(cacheKey, this.CACHE_EXPIRY, JSON.stringify(comparison));
        logger.info('Saved outlet comparison to Redis cache');
      }
    } catch (error) {
      logger.error('Failed to save outlet comparison cache to Redis:', error);
    }

    return comparison;
  }

  async getReports(outletId: string, startDateStr?: string, endDateStr?: string) {
    const end = endDateStr ? new Date(endDateStr) : new Date();
    const start = startDateStr ? new Date(startDateStr) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.analyticsRepository.getReports(outletId, start, end);
  }
}
export default AnalyticsService;
