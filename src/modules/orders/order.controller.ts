import { Request, Response, NextFunction } from 'express';
import { OrderService } from './order.service';
import { sendSuccess } from '../../utils/response';
import { emitKDSUpdate } from '../../config/socket';

export class OrderController {
  private orderService = new OrderService();

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const user = req.user;
      const result = await this.orderService.createOrder(outletId, req.body, user);
      emitKDSUpdate(outletId, { type: 'KDS_UPDATE', outletId, order: result });
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const status = req.query.status as string | undefined;
      const excludeCompleted = req.query.excludeCompleted === 'true';
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const placedByName = req.query.placedByName as string | undefined;
      const source = req.query.source as string | undefined;
      const paymentMethod = req.query.paymentMethod as string | undefined;
      const businessId = req.user?.businessId || undefined;

      const result = await this.orderService.getOrders(outletId, status, {
        excludeCompleted,
        startDate,
        endDate,
        placedByName,
        source,
        paymentMethod,
        businessId,
      });
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getKitchenOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = req.user?.businessId || undefined;
      const result = await this.orderService.getKitchenOrders(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  createPayment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id: orderId } = req.params;
      const businessId = req.user?.businessId;
      const result = await this.orderService.createPayment(outletId, orderId, req.body, businessId);
      emitKDSUpdate(outletId, { type: 'KDS_UPDATE', outletId, orderId }, businessId);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id: orderId } = req.params;
      const { status, comment, paymentMethod, customerName, customerPhone } = req.body;
      const changedById = req.user!.id; // Logged in user ID
      const businessId = req.user?.businessId;

      const result = await this.orderService.updateOrderStatus(
        outletId,
        orderId,
        status,
        comment,
        changedById,
        paymentMethod,
        customerName,
        customerPhone,
        businessId,
        req.user?.role
      );
      // Notify the order's own outlet (also when the change was made in "all outlets" mode)
      const targetOutletId = result?.outletId || outletId;
      emitKDSUpdate(targetOutletId, { type: 'KDS_UPDATE', outletId: targetOutletId, orderId, status, order: result }, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  setServiceChargeWaiver = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = req.user?.businessId;
      const { waive, reason } = req.body;
      const result = await this.orderService.setServiceChargeWaiver(
        outletId,
        req.params.id,
        waive,
        reason,
        req.user!.id,
        businessId
      );
      const targetOutletId = result?.outletId || outletId;
      emitKDSUpdate(targetOutletId, { type: 'KDS_UPDATE', outletId: targetOutletId, orderId: req.params.id, order: result }, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getTableMenu = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.params;
      const result = await this.orderService.getTableMenu(token);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default OrderController;
