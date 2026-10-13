import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service';
import { sendSuccess } from '../../utils/response';
import { prisma } from '../../config/prisma';

export class AnalyticsController {
  private analyticsService = new AnalyticsService();

  getDailySummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { startDate, endDate } = req.query;
      const result = await this.analyticsService.getDailySummary(
        outletId,
        startDate as string,
        endDate as string
      );
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getBestWorstSellers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.analyticsService.getBestWorstSellers(outletId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getOutletComparison = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Compares the caller's own business's outlets only; managers see just the outlets they're assigned to
      const user = req.user!;
      let outletIds: string[] | undefined;
      if (user.role === 'MANAGER') {
        const assignments = await prisma.userOutlet.findMany({
          where: { userId: user.id },
          select: { outletId: true },
        });
        outletIds = assignments.map((a) => a.outletId);
      }
      const result = await this.analyticsService.getOutletComparison({
        businessId: user.businessId,
        outletIds,
        isSuperAdmin: user.role === 'SUPER_ADMIN',
      });
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getReports = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { startDate, endDate } = req.query;
      const result = await this.analyticsService.getReports(
        outletId,
        startDate as string,
        endDate as string
      );
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default AnalyticsController;
