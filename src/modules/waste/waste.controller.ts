import { Request, Response, NextFunction } from 'express';
import { WasteService } from './waste.service';
import { sendSuccess, sendList } from '../../utils/response';
import { getPaginationParams } from '../../utils/pagination';

export class WasteController {
  private wasteService = new WasteService();

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const loggedById = req.user!.id; // Logged in user ID
      const result = await this.wasteService.createWasteLog(outletId, loggedById, req.body, req.user?.businessId);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const { limit, offset } = getPaginationParams(req);
      const { data, total } = await this.wasteService.getWasteLogs(outletId, limit, offset, businessId);
      return sendList(res, data, { limit, offset, total });
    } catch (error) {
      next(error);
    }
  };

  summary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.wasteService.getWasteSummary(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default WasteController;
