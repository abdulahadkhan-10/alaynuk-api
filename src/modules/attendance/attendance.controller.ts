import { Request, Response, NextFunction } from 'express';
import { AttendanceService } from './attendance.service';
import { sendSuccess } from '../../utils/response';

export class AttendanceController {
  private attendanceService = new AttendanceService();

  private getActor(req: Request) {
    return { userId: req.user?.id, role: req.user?.role, businessId: req.user?.businessId };
  }

  checkIn = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { employeeId, latitude, longitude, confirmOffDay } = req.body;
      const result = await this.attendanceService.checkIn(outletId, this.getActor(req), {
        employeeId,
        latitude,
        longitude,
        confirmOffDay,
      });
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  checkOut = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { employeeId, latitude, longitude } = req.body;
      const result = await this.attendanceService.checkOut(outletId, this.getActor(req), {
        employeeId,
        latitude,
        longitude,
      });
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  correct = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { checkInTime, checkOutTime, reason } = req.body;
      const result = await this.attendanceService.correctAttendance(outletId, this.getActor(req), req.params.id, {
        checkInTime,
        checkOutTime,
        reason,
      });
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  listLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const businessId = (req as any).user?.businessId;
      const result = await this.attendanceService.getAttendanceLogs(outletId, businessId);
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default AttendanceController;
