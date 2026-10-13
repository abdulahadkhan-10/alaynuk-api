import { TicketRepository } from './ticket.repository';
import { AppError } from '../../utils/AppError';
import { prisma } from '../../config/prisma';
import { NotificationService } from '../notifications/notification.service';

const ESCALATION_KEYWORDS = [
  'food safety',
  'food poisoning',
  'allergy',
  'billing dispute',
  'charged twice',
  'fraud',
  'harassment',
  'urgent',
  'safety',
];

export class TicketService {
  private ticketRepository = new TicketRepository();

  private determinePriority(text: string): 'HIGH' | 'NORMAL' {
    const lowerText = text.toLowerCase();
    const matches = ESCALATION_KEYWORDS.some((keyword) => lowerText.includes(keyword));
    return matches ? 'HIGH' : 'NORMAL';
  }

  async createFeedback(data: { orderId: string; rating: number; comment: string; source: string }) {
    const order = await prisma.order.findFirst({
      where: { id: data.orderId, deletedAt: null },
    });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
    }

    const outletId = order.outletId;
    const feedback = await this.ticketRepository.createFeedback(outletId, data);
    const priority = this.determinePriority(data.comment);

    const ticket = await this.ticketRepository.createTicket(outletId, {
      title: `Customer Feedback - Rating ${data.rating}/5`,
      description: data.comment,
      priority,
      sourceTable: 'Feedback',
      sourceId: feedback.id,
    });

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { businessId: true } });
    NotificationService.notifyTicketCreated({
      id: ticket.id,
      title: ticket.title,
      priority: ticket.priority,
      outletId,
      businessId: outlet?.businessId,
    }).catch(() => {});

    return feedback;
  }

  async createStaffQuery(
    userId: string,
    outletIdFromReq: string | undefined,
    data: { employeeId?: string; outletId?: string; category: string; description: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' }
  ) {
    let targetOutletId = data.outletId || outletIdFromReq;

    // Find employee by userId
    let employee = await prisma.employee.findFirst({
      where: {
        userId,
        deletedAt: null,
      },
    });

    if (!employee) {
      // If user specified employeeId explicitly, check that
      if (data.employeeId) {
        employee = await prisma.employee.findFirst({
          where: { id: data.employeeId, deletedAt: null },
        });
      }
    }

    if (!employee) {
      // Fallback: check user details and create or find employee profile if missing
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User record not found', 404);
      }

      if (!targetOutletId) {
        // Try user outlet link
        const userOutlet = await prisma.userOutlet.findFirst({ where: { userId } });
        targetOutletId = userOutlet?.outletId;
      }

      if (!targetOutletId) {
        throw new AppError('OUTLET_REQUIRED', 'Outlet ID is required to submit a query', 400);
      }

      employee = await prisma.employee.create({
        data: {
          outletId: targetOutletId,
          userId: user.id,
          name: user.name,
          email: user.email,
          phone: user.phoneNo,
          role: user.role,
          joiningDate: new Date(),
        },
      });
    }

    const outletId = targetOutletId || employee.outletId;

    // 1. Create StaffQuery
    const query = await this.ticketRepository.createStaffQuery(outletId, {
      employeeId: employee.id,
      category: data.category,
      description: data.description,
    });

    // 2. Determine escalation priority
    const priority = data.priority || this.determinePriority(`${data.category} ${data.description}`);

    // 3. Auto-generate Ticket
    const ticket = await this.ticketRepository.createTicket(outletId, {
      title: `Staff Query - ${data.category}`,
      description: data.description,
      priority,
      sourceTable: 'StaffQuery',
      sourceId: query.id,
    });

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { businessId: true } });
    NotificationService.notifyTicketCreated({
      id: ticket.id,
      title: ticket.title,
      priority: ticket.priority,
      outletId,
      businessId: outlet?.businessId,
    }).catch(() => {});

    return query;
  }

  async getTickets(
    user: { id: string; role: string; businessId?: string | null },
    filter: { outletId?: string | string[]; sourceTable?: string; status?: string; limit: number; offset: number }
  ) {
    let outletIdFilter: string | string[] | undefined = filter.outletId;

    if (!filter.outletId || filter.outletId === 'all' || filter.outletId === 'undefined') {
      if (user.role === 'BUSINESS_OWNER' && user.businessId) {
        const outlets = await prisma.outlet.findMany({
          where: { businessId: user.businessId, deletedAt: null },
          select: { id: true },
        });
        outletIdFilter = outlets.map((o) => o.id);
      } else {
        outletIdFilter = undefined;
      }
    }

    return this.ticketRepository.findTickets({
      outletId: outletIdFilter,
      sourceTable: filter.sourceTable,
      status: filter.status,
      limit: filter.limit,
      offset: filter.offset,
    });
  }

  async getMyQueries(userId: string) {
    return this.ticketRepository.findMyQueries(userId);
  }

  async updateTicketStatus(
    ticketId: string,
    status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED',
    comment?: string,
    changedById?: string
  ) {
    const ticket = await this.ticketRepository.findTicketById(ticketId);
    if (!ticket) {
      throw new AppError('TICKET_NOT_FOUND', 'Ticket not found', 404);
    }

    const currentStatus = ticket.status;

    // Allowed status transitions
    const isValidTransition =
      (currentStatus === 'OPEN' && status === 'IN_PROGRESS') ||
      (currentStatus === 'OPEN' && status === 'RESOLVED') ||
      (currentStatus === 'IN_PROGRESS' && status === 'RESOLVED');

    if (!isValidTransition && currentStatus !== status) {
      throw new AppError('INVALID_STATE_TRANSITION', `Invalid status transition from ${currentStatus} to ${status}`, 400);
    }

    if (currentStatus === status) {
      return ticket;
    }

    const updated = await this.ticketRepository.updateTicket(ticketId, status);
    await this.ticketRepository.addTicketHistory(ticketId, status, changedById, comment);

    // Sync underlying staff query status if ticket originated from StaffQuery
    if (ticket.sourceTable === 'StaffQuery') {
      await this.ticketRepository.updateStaffQueryStatus(ticket.sourceId, status);
    }

    return updated;
  }
}
export default TicketService;

