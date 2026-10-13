import { Request, Response, NextFunction } from 'express';
import { InventoryService } from './inventory.service';
import { sendSuccess } from '../../utils/response';

export class InventoryController {
  private inventoryService = new InventoryService();

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const actor = { userId: req.user!.id, role: req.user!.role, businessId: req.user!.businessId };
      const result = await this.inventoryService.createItem(outletId, req.body, actor);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  getStock = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const result = await this.inventoryService.getItemStock(outletId, id, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  adjust = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const { change, reason } = req.body;
      const loggedById = req.user?.id;
      const result = await this.inventoryService.adjustStock(
        outletId,
        id,
        change,
        reason,
        undefined,
        loggedById,
        req.user?.businessId
      );
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };


  createRecipe = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { menuItemId, itemId, quantityPerUnit } = req.body;
      const result = await this.inventoryService.createRecipe(
        outletId,
        { menuItemId, itemId, quantityPerUnit },
        req.user?.businessId
      );
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  getMenuItemCost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const result = await this.inventoryService.calculateMenuItemCost(outletId, id, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.inventoryService.getAllItems(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getAlerts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.inventoryService.getAlerts(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default InventoryController;

