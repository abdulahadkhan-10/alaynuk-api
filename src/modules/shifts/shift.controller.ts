import { Request, Response, NextFunction } from 'express';
import { ShiftService } from './shift.service';
import { sendSuccess } from '../../utils/response';
import { EmployeeActor } from '../employees/employee.permissions';

export class ShiftController {
  private shiftService = new ShiftService();

  private getActor(req: Request): EmployeeActor {
    return { userId: req.user!.id, role: req.user!.role, businessId: req.user!.businessId };
  }

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let outletId = req.outletId!;
      if (outletId === 'all') {
        const { prisma } = require('../../config/prisma');
        const firstOutlet = await prisma.outlet.findFirst({
          where: { businessId: req.user?.businessId }
        });
        if (!firstOutlet) {
          throw new Error('No outlets found for this business to create a shift.');
        }
        outletId = firstOutlet.id;
      }
      const result = await this.shiftService.createShift(outletId, req.body);
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.shiftService.getShifts(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  assign = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id: shiftId } = req.params;
      const { employeeId, employeeIds, date, replaceExisting } = req.body;

      const targetEmpIds: string[] = Array.isArray(employeeIds) && employeeIds.length > 0
        ? employeeIds
        : (employeeId ? [employeeId] : []);

      const result = await this.shiftService.assignShiftBulk(
        outletId,
        shiftId,
        targetEmpIds,
        date,
        Boolean(replaceExisting),
        req.user?.businessId
      );

      if (result.assignedCount === 0 && result.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: result.errors[0]?.error || 'Shift assignment failed due to conflicts.',
          data: result,
        });
      }

      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  updateAssignment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { assignmentId } = req.params;
      const result = await this.shiftService.updateShiftAssignment(outletId, assignmentId, req.body, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  deleteAssignment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { assignmentId } = req.params;
      const result = await this.shiftService.deleteShiftAssignment(outletId, assignmentId, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateShiftTemplate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const result = await this.shiftService.updateShift(outletId, id, req.body, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  deleteShiftTemplate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const result = await this.shiftService.deleteShift(outletId, id, req.user?.businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  requestSwap = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.shiftService.createSwapRequest(outletId, req.body, this.getActor(req));
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  respondToSwap = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.shiftService.respondToSwap(outletId, req.params.id, req.body.accept, this.getActor(req));
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateSwapStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const { status } = req.body;
      const result = await this.shiftService.updateSwapStatus(outletId, id, status, this.getActor(req));
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getEmployeeRoster = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { employeeId } = req.params;
      const result = await this.shiftService.getEmployeeRoster(employeeId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  getOutletRosters = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.shiftService.getOutletRosters(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  setWeeklyRoster = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { employeeId, weeklySchedule } = req.body;
      const result = await this.shiftService.setWeeklyRoster(outletId, employeeId, weeklySchedule);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default ShiftController;
