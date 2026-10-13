import { Request, Response, NextFunction } from 'express';
import { EmployeeService } from './employee.service';
import { EmployeeBulkService } from './employee-bulk.service';
import { sendSuccess, sendList } from '../../utils/response';
import { getPaginationParams } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { EmployeeActor } from './employee.permissions';

export class EmployeeController {
  private employeeService = new EmployeeService();
  private employeeBulkService = new EmployeeBulkService();

  private getActor(req: Request): EmployeeActor {
    return { userId: req.user!.id, role: req.user!.role, businessId: req.user!.businessId };
  }

  bulkUpload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      if (!req.file) {
        throw new AppError('FILE_REQUIRED', 'Please upload an Excel or CSV file', 400);
      }
      const result = await this.employeeBulkService.processExcelFile(outletId, req.file.buffer, this.getActor(req));
      return sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.employeeService.createEmployee(outletId, req.body, this.getActor(req));
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
      const { data, total } = await this.employeeService.getEmployees(outletId, limit, offset, businessId);
      return sendList(res, data, { limit, offset, total });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const result = await this.employeeService.updateEmployee(outletId, id, req.body, this.getActor(req));
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      await this.employeeService.deleteEmployee(outletId, id, this.getActor(req));
      return sendSuccess(res, { message: 'Employee profile deleted' });
    } catch (error) {
      next(error);
    }
  };

  uploadDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;

      if (!req.file) {
        throw new AppError('FILE_REQUIRED', 'Please upload a file', 400);
      }

      const doc = await this.employeeService.addDocument(
        outletId,
        id,
        req.file.originalname,
        req.file.path,
        req.file.mimetype,
        req.file.size
      );

      return sendSuccess(res, doc, 201);
    } catch (error) {
      next(error);
    }
  };

  createLeave = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.employeeService.createLeaveRequest(outletId, req.body, this.getActor(req));
      return sendSuccess(res, result, 201);
    } catch (error) {
      next(error);
    }
  };

  listLeaves = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const result = await this.employeeService.getLeaveRequests(outletId, this.getActor(req));
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  updateLeaveStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outletId = req.outletId!;
      const { id } = req.params;
      const { status } = req.body;
      const result = await this.employeeService.updateLeaveRequestStatus(outletId, id, status, this.getActor(req));
      return sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };
}
export default EmployeeController;
