import { prisma } from '../../config/prisma';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export class TableRepository {
  async findTablesByOutlet(outletId: string) {
    const tables = await db.table.findMany({
      where: {
        outletId,
      },
      include: {
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            userId: true,
          },
        },
        tokens: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        tableNumber: 'asc',
      },
    });

    const activeOrders = await prisma.order.findMany({
      where: {
        outletId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        deletedAt: null,
      },
      select: { tableNumber: true },
    });

    const occupiedTableNumbers = new Set(
      activeOrders
        .map((o) => o.tableNumber)
        .filter((n): n is number => n !== null && n !== undefined)
    );

    return tables.map((t: any) => {
      if (occupiedTableNumbers.has(t.tableNumber)) {
        return { ...t, status: 'OCCUPIED' };
      }
      return t;
    });
  }

  async getMaxTableNumber(outletId: string): Promise<number> {
    const aggregate = await db.table.aggregate({
      where: {
        outletId,
      },
      _max: {
        tableNumber: true,
      },
    });
    return aggregate._max.tableNumber || 0;
  }

  async findTableById(outletId: string, id: string) {
    return db.table.findFirst({
      where: {
        id,
        outletId,
      },
      include: {
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            userId: true,
          },
        },
        tokens: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });
  }

  async updateTable(
    outletId: string,
    id: string,
    data: { status?: 'AVAILABLE' | 'OCCUPIED'; assignedStaffId?: string | null }
  ) {
    return db.table.update({
      where: { id },
      data,
      include: {
        assignedStaff: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            userId: true,
          },
        },
      },
    });
  }

  async deleteTable(outletId: string, id: string) {
    return prisma.$transaction(async (tx: any) => {
      // Hard delete the table (and cascading tokens)
      await tx.table.delete({
        where: { id },
      });

      // Fetch all remaining tables ordered by tableNumber ascending
      const remainingTables = await tx.table.findMany({
        where: { outletId },
        orderBy: { tableNumber: 'asc' },
      });

      // Renumber sequential table numbers (1, 2, 3...)
      for (let i = 0; i < remainingTables.length; i++) {
        const expectedNum = i + 1;
        if (remainingTables[i].tableNumber !== expectedNum) {
          await tx.table.update({
            where: { id: remainingTables[i].id },
            data: { tableNumber: expectedNum },
          });
        }
      }
    });
  }

  async createTableWithToken(
    outletId: string,
    tableNumber: number,
    token: string,
    expiresAt: Date
  ) {
    return prisma.$transaction(async (tx: any) => {
      const table = await tx.table.create({
        data: {
          outletId,
          tableNumber,
          status: 'AVAILABLE',
        },
      });

      const tableToken = await tx.tableToken.create({
        data: {
          outletId,
          tableId: table.id,
          tableNumber: table.tableNumber,
          token,
          expiresAt,
        },
      });

      return { ...table, token: tableToken };
    });
  }

  async generateNewToken(
    outletId: string,
    tableId: string,
    tableNumber: number,
    token: string,
    expiresAt: Date
  ) {
    return db.tableToken.create({
      data: {
        outletId,
        tableId,
        tableNumber,
        token,
        expiresAt,
      },
    });
  }
}
