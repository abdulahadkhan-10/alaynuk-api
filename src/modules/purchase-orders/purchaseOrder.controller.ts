import { Request, Response, NextFunction } from 'express';
import { PurchaseOrderService } from './purchaseOrder.service';
import { sendSuccess } from '../../utils/response';

export class PurchaseOrderController {
  private poService = new PurchaseOrderService();

  createSupplier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.poService.createSupplier(outletId, businessId, req.body);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  getSuppliers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.poService.getSuppliers(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  deleteSupplier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      await this.poService.deleteSupplier(outletId, id, req.user?.businessId);
      return sendSuccess(res, { message: 'Supplier deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  updateSupplier = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      await this.poService.updateSupplier(outletId, id, req.body, req.user?.businessId);
      return sendSuccess(res, { message: 'Supplier updated successfully' });
    } catch (error) {
      next(error);
    }
  };

  getPOs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.poService.getPurchaseOrders(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  createPO = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { supplierId, items } = req.body;
      const result = await this.poService.createPO(outletId, supplierId, items, req.user?.businessId);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  receivePO = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const { items } = req.body;
      const result = await this.poService.receivePO(outletId, id, items, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  cancelPO = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.poService.cancelPO(req.outletId!, req.params.id, req.body.reason, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  closePO = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.poService.closePO(req.outletId!, req.params.id, req.body.reason, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  // --- Supplier Portal Handlers ---

  getSupplierPortalOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const result = await this.poService.getSupplierPortalOrders(userId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateSupplierPOStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const result = await this.poService.updateSupplierPOStatus(userId, id, req.body);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}

export default PurchaseOrderController;
