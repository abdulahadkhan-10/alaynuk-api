import * as XLSX from 'xlsx';
import bcrypt from 'bcrypt';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { EmployeeActor, EmployeeRole, assertOutletsAccessible, canAssignRole } from './employee.permissions';

export interface BulkUploadResult {
  totalRows: number;
  successCount: number;
  skippedCount: number;
  errors: { row: number; email?: string; message: string }[];
}

export class EmployeeBulkService {
  async processExcelFile(outletId: string, fileBuffer: Buffer, actor: EmployeeActor): Promise<BulkUploadResult> {
    // Rejects "all outlets" mode and outlets outside the caller's business / assignment
    await assertOutletsAccessible(actor, [outletId]);

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new AppError('INVALID_FILE', 'The uploaded Excel file contains no worksheets', 400);
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (rawRows.length === 0) {
      throw new AppError('EMPTY_FILE', 'The uploaded Excel file has no data rows', 400);
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { businessId: true },
    });

    if (!outlet) {
      throw new AppError('OUTLET_NOT_FOUND', 'Active outlet was not found', 404);
    }

    let successCount = 0;
    let skippedCount = 0;
    const errors: { row: number; email?: string; message: string }[] = [];

    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      const rowNum = index + 2;

      const getVal = (...keys: string[]): string => {
        for (const k of keys) {
          for (const rowKey of Object.keys(row)) {
            if (rowKey.trim().toLowerCase() === k.toLowerCase()) {
              return String(row[rowKey]).trim();
            }
          }
        }
        return '';
      };

      const name = getVal('name', 'full name', 'fullname', 'employee name');
      const email = getVal('email', 'email address', 'username');
      const password = getVal('password', 'pass');
      const phone = getVal('phone', 'phone number', 'phoneno', 'mobile');
      let roleStr = getVal('role', 'job role').toUpperCase();
      const joiningDateStr = getVal('joiningdate', 'joining date', 'date');

      if (!name || !email || !password || !phone) {
        skippedCount++;
        errors.push({
          row: rowNum,
          email,
          message: 'Missing required fields (Name, Email, Password, or Phone)',
        });
        continue;
      }

      let role: EmployeeRole = 'STAFF';
      if (roleStr === 'MANAGER') role = 'MANAGER';
      else if (roleStr === 'KITCHEN') role = 'KITCHEN';
      else if (roleStr === 'BUSINESS_OWNER' || roleStr === 'OWNER') role = 'BUSINESS_OWNER';

      if (!canAssignRole(actor, role)) {
        skippedCount++;
        errors.push({ row: rowNum, email, message: `You are not allowed to assign the ${role} role` });
        continue;
      }

      if (!email.includes('@')) {
        skippedCount++;
        errors.push({ row: rowNum, email, message: 'Invalid email address format' });
        continue;
      }

      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        skippedCount++;
        errors.push({ row: rowNum, email, message: 'Email address already registered' });
        continue;
      }

      try {
        const passwordHash = await bcrypt.hash(password, 10);
        const joiningDate = joiningDateStr ? new Date(joiningDateStr) : new Date();

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              name,
              email,
              passwordHash,
              phoneNo: phone,
              role,
              businessId: outlet.businessId,
              outlets: {
                create: [{ outletId }],
              },
            },
          });

          await tx.employee.create({
            data: {
              name,
              phone,
              email,
              role,
              joiningDate,
              status: 'ACTIVE',
              outletId,
              userId: user.id,
            },
          });
        });

        successCount++;
      } catch (err: any) {
        skippedCount++;
        errors.push({
          row: rowNum,
          email,
          message: err?.message || 'Failed to create database record',
        });
      }
    }

    return {
      totalRows: rawRows.length,
      successCount,
      skippedCount,
      errors,
    };
  }
}
