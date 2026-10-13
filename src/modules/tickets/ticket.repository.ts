import { prisma } from '../../config/prisma';

export class TicketRepository {
  async findEmployeeByUserId(userId: string, outletId?: string) {
    return prisma.employee.findFirst({
      where: {
        userId,
        ...(outletId ? { outletId } : {}),
        deletedAt: null,
      },
    });
  }

  async createFeedback(outletId: string, data: any) {
    return prisma.feedback.create({
      data: {
        outletId,
        orderId: data.orderId,
        rating: data.rating,
        comment: data.comment,
        source: data.source,
      },
    });
  }

  async createStaffQuery(outletId: string, data: { employeeId: string; category: string; description: string }) {
    return prisma.staffQuery.create({
      data: {
        outletId,
        employeeId: data.employeeId,
        category: data.category,
        description: data.description,
      },
    });
  }

  async createTicket(
    outletId: string,
    data: {
      title: string;
      description: string;
      priority: 'LOW' | 'NORMAL' | 'HIGH';
      sourceTable: string;
      sourceId: string;
    }
  ) {
    return prisma.ticket.create({
      data: {
        outletId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        sourceTable: data.sourceTable,
        sourceId: data.sourceId,
        status: 'OPEN',
        histories: {
          create: {
            status: 'OPEN',
            comment: 'Ticket automatically created',
          },
        },
      },
      include: {
        histories: true,
      },
    });
  }

  async findTickets(filter: {
    outletId?: string | string[];
    sourceTable?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    const where: any = {};
    if (filter.outletId) {
      if (Array.isArray(filter.outletId)) {
        const validUuids = filter.outletId.filter(
          (id) => typeof id === 'string' && id !== 'all' && id !== 'undefined' && id.trim() !== ''
        );
        if (validUuids.length === 1) {
          where.outletId = validUuids[0];
        } else if (validUuids.length > 1) {
          where.outletId = { in: validUuids };
        }
      } else if (
        typeof filter.outletId === 'string' &&
        filter.outletId !== 'all' &&
        filter.outletId !== 'undefined' &&
        filter.outletId.trim() !== ''
      ) {
        where.outletId = filter.outletId;
      }
    }
    if (filter.sourceTable) {
      where.sourceTable = filter.sourceTable;
    }
    if (filter.status) {
      where.status = filter.status;
    }

    const [rawTickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        take: filter.limit,
        skip: filter.offset,
        orderBy: { createdAt: 'desc' },
        include: {
          outlet: { select: { id: true, name: true, city: true } },
          histories: { orderBy: { createdAt: 'asc' } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    const staffQueryIds = rawTickets.filter((t) => t.sourceTable === 'StaffQuery').map((t) => t.sourceId);
    const feedbackIds = rawTickets.filter((t) => t.sourceTable === 'Feedback').map((t) => t.sourceId);

    const [staffQueries, feedbacks] = await Promise.all([
      staffQueryIds.length > 0
        ? prisma.staffQuery.findMany({
            where: { id: { in: staffQueryIds } },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  role: true,
                  email: true,
                  phone: true,
                },
              },
            },
          })
        : [],
      feedbackIds.length > 0
        ? prisma.feedback.findMany({
            where: { id: { in: feedbackIds } },
            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  tableNumber: true,
                  totalPaise: true,
                },
              },
            },
          })
        : [],
    ]);

    const staffQueryMap = new Map(staffQueries.map((sq) => [sq.id, sq]));
    const feedbackMap = new Map(feedbacks.map((f) => [f.id, f]));

    const enrichedTickets = rawTickets.map((t) => ({
      ...t,
      staffQuery: t.sourceTable === 'StaffQuery' ? staffQueryMap.get(t.sourceId) || null : null,
      feedback: t.sourceTable === 'Feedback' ? feedbackMap.get(t.sourceId) || null : null,
    }));

    return { data: enrichedTickets, total };
  }

  async findTicketById(id: string) {
    return prisma.ticket.findFirst({
      where: { id },
      include: {
        outlet: { select: { id: true, name: true, city: true } },
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async updateTicket(id: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED') {
    return prisma.ticket.update({
      where: { id },
      data: { status },
    });
  }

  async updateStaffQueryStatus(id: string, status: string) {
    return prisma.staffQuery.update({
      where: { id },
      data: { status },
    });
  }

  async addTicketHistory(ticketId: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED', changedById?: string, comment?: string) {
    return prisma.ticketHistory.create({
      data: {
        ticketId,
        status,
        changedById,
        comment,
      },
    });
  }

  async findMyQueries(userId: string) {
    const employee = await prisma.employee.findFirst({
      where: { userId, deletedAt: null },
    });

    if (!employee) return [];

    const queries = await prisma.staffQuery.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: {
        outlet: { select: { id: true, name: true, city: true } },
      },
    });

    const sourceIds = queries.map((q) => q.id);
    const tickets = await prisma.ticket.findMany({
      where: { sourceTable: 'StaffQuery', sourceId: { in: sourceIds } },
      include: {
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });

    const ticketMap = new Map(tickets.map((t) => [t.sourceId, t]));

    return queries.map((q) => ({
      ...q,
      ticket: ticketMap.get(q.id) || null,
    }));
  }
}
export default TicketRepository;

