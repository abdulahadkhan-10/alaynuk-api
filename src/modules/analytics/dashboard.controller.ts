import { Request, Response, NextFunction } from 'express';
import { DashboardService } from './dashboard.service';
import { sendSuccess } from '../../utils/response';

export class DashboardController {
  private dashboardService = new DashboardService();

  getKpi = async (req: Request, res: Response, NextFunction: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const range = req.query.range as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const result = await this.dashboardService.getKpis(outletId, businessId, range, startDate, endDate);
      return sendSuccess(res, result);
    } catch (error) {
      NextFunction(error);
    }
  };

  getSalesVelocity = async (req: Request, res: Response, NextFunction: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const range = req.query.range as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const result = await this.dashboardService.getSalesVelocity(outletId, businessId, range, startDate, endDate);
      return sendSuccess(res, result);
    } catch (error) {
      NextFunction(error);
    }
  };

  getChannelDistribution = async (req: Request, res: Response, NextFunction: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const range = req.query.range as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const result = await this.dashboardService.getChannelDistribution(outletId, businessId, range, startDate, endDate);
      return sendSuccess(res, result);
    } catch (error) {
      NextFunction(error);
    }
  };

  getTopSellingItems = async (req: Request, res: Response, NextFunction: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const range = req.query.range as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const result = await this.dashboardService.getTopSellingItems(outletId, businessId, range, startDate, endDate);
      return sendSuccess(res, result);
    } catch (error) {
      NextFunction(error);
    }
  };

  getSalesForecast = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const result = await this.dashboardService.getSalesForecast(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getInventoryForecast = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId || (req.query.outletId as string);
      const businessId = req.businessId;
      const result = await this.dashboardService.getInventoryForecast(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
