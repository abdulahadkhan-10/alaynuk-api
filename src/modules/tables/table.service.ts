import { randomUUID } from 'crypto';
import { TableRepository } from './table.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';

export class TableService {
  private repository = new TableRepository();

  // Tokens valid for 10 years (long-lived QR codes for physical table stickers)
  private getFarFutureExpiry(): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    return d;
  }

  async getTables(outletId: string) {
    const tables = await this.repository.findTablesByOutlet(outletId);
    return tables.map((t: any) => ({
      id: t.id,
      tableNumber: t.tableNumber,
      status: t.status,
      assignedStaffId: t.assignedStaffId || t.assignedStaff?.id || null,
      assignedStaff: t.assignedStaff ? {
        id: t.assignedStaff.id,
        name: t.assignedStaff.name,
        email: t.assignedStaff.email,
        role: t.assignedStaff.role,
      } : null,
      currentToken: t.tokens && t.tokens.length > 0 ? t.tokens[0].token : null,
      tokenExpiresAt: t.tokens[0]?.expiresAt || null,
      createdAt: t.createdAt,
    }));
  }

  async createBulkTables(outletId: string, count: number) {
    let currentMaxNumber = await this.repository.getMaxTableNumber(outletId);

    const createdTables = [];
    const expiresAt = this.getFarFutureExpiry();

    for (let i = 0; i < count; i++) {
      currentMaxNumber += 1;
      const token = randomUUID();
      const table = await this.repository.createTableWithToken(
        outletId,
        currentMaxNumber,
        token,
        expiresAt
      );
      createdTables.push(table);
    }

    return createdTables;
  }

  async updateTable(
    outletId: string,
    tableId: string,
    data: { status?: 'AVAILABLE' | 'OCCUPIED'; assignedStaffId?: string | null }
  ) {
    const existing = await this.repository.findTableById(outletId, tableId);
    if (!existing) {
      throw new AppError('TABLE_NOT_FOUND', 'Table not found', 404);
    }

    if (data.assignedStaffId) {
      const staff = await prisma.employee.findUnique({
        where: { id: data.assignedStaffId }
      });
      if (!staff || staff.outletId !== existing.outletId) {
        throw new AppError('INVALID_STAFF', 'Staff member does not belong to this outlet', 400);
      }
      if (staff.role !== 'STAFF') {
        throw new AppError('INVALID_STAFF', 'Only staff members can be assigned to tables', 400);
      }
    }

    return this.repository.updateTable(outletId, tableId, data);
  }

  async regenerateQRToken(outletId: string, tableId: string) {
    const existing = await this.repository.findTableById(outletId, tableId);
    if (!existing) {
      throw new AppError('TABLE_NOT_FOUND', 'Table not found', 404);
    }
    const token = randomUUID();
    const expiresAt = this.getFarFutureExpiry();
    const tableToken = await this.repository.generateNewToken(
      outletId,
      tableId,
      existing.tableNumber,
      token,
      expiresAt
    );
    return {
      tableId: existing.id,
      tableNumber: existing.tableNumber,
      token: tableToken.token,
      expiresAt: tableToken.expiresAt,
    };
  }

  async deleteTable(outletId: string, tableId: string) {
    const existing = await this.repository.findTableById(outletId, tableId);
    if (!existing) {
      throw new AppError('TABLE_NOT_FOUND', 'Table not found', 404);
    }
    return this.repository.deleteTable(outletId, tableId);
  }
}
