import { Request, Response, NextFunction } from 'express';
import { TicketService } from './ticket.service';
import { sendSuccess, sendList } from '../../utils/response';
import { getPaginationParams } from '../../utils/pagination';

export class TicketController {
  private ticketService = new TicketService();

  createFeedback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.ticketService.createFeedback(req.body);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  createStaffQuery = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const outletId = (req.body?.outletId as string) || (req.query.outletId as string) || (req.headers['x-outlet-id'] as string) || req.outletId;
      const result = await this.ticketService.createStaffQuery(userId, outletId, req.body);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset } = getPaginationParams(req);
      const outletIdParam = req.query.outletId as string | undefined;
      const headerOutletId = req.headers['x-outlet-id'] as string | undefined;
      const outletId = outletIdParam || headerOutletId || req.outletId;
      const sourceTable = req.query.sourceTable as string | undefined;
      const status = req.query.status as string | undefined;

      const { data, total } = await this.ticketService.getTickets(req.user!, {
        outletId,
        sourceTable,
        status,
        limit,
        offset,
      });
      return sendList(res, data, { limit, offset, total });
    } catch (error) {
      next(error);
    }
  };

  getMyQueries = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const data = await this.ticketService.getMyQueries(userId);
      return sendSuccess(res, data);
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { status, comment } = req.body;
      const changedById = req.user!.id;

      const result = await this.ticketService.updateTicketStatus(
        id,
        status,
        comment,
        changedById
      );
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default TicketController;

