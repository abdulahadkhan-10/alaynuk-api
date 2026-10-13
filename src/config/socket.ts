import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from './env';
import { logger } from './logger';
import { prisma } from './prisma';

let io: SocketIOServer | null = null;

interface SocketUser {
  id: string;
  role: string;
  businessId?: string | null;
}

/*
 * Real-time channel security:
 *  - A valid login is REQUIRED to connect (same JWT as normal API requests, read from the login
 *    cookie or the handshake `auth.token`). Disabled/deleted accounts are refused.
 *  - Identity (user, role, business, supplier) comes ONLY from the verified token / database —
 *    anything the browser claims in the handshake is ignored.
 *  - Every room join is checked with the same access rules as the REST API.
 */

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function extractToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken) return authToken;
  const cookieHeader = socket.handshake.headers.cookie;
  return readCookie(cookieHeader, 'token') || readCookie(cookieHeader, 'alayn_admin_token');
}

/** Same rule as businessMiddleware: owners/super admins any outlet of their business; others only assigned outlets. */
export async function canAccessOutlet(user: SocketUser, outletId: string, supplierOutletId?: string | null): Promise<boolean> {
  if (!outletId || outletId === 'all') return false;
  if (user.role === 'SUPPLIER') return outletId === supplierOutletId;
  if (user.role !== 'SUPER_ADMIN' && !user.businessId) return false;

  const outlet = await prisma.outlet.findFirst({
    where: {
      id: outletId,
      deletedAt: null,
      ...(user.role !== 'SUPER_ADMIN' ? { businessId: user.businessId as string } : {}),
    },
    select: { id: true },
  });
  if (!outlet) return false;
  if (user.role === 'BUSINESS_OWNER' || user.role === 'SUPER_ADMIN') return true;

  const assignment = await prisma.userOutlet.findUnique({
    where: { userId_outletId: { userId: user.id, outletId } },
  });
  return !!assignment;
}

export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = extractToken(socket);
    if (!token) return next(new Error('UNAUTHORIZED'));

    let decoded: SocketUser;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as SocketUser;
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }

    const account = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, businessId: true, isActive: true, deletedAt: true },
    });
    if (!account || !account.isActive || account.deletedAt) {
      return next(new Error('UNAUTHORIZED'));
    }

    socket.data.user = { id: account.id, role: account.role, businessId: account.businessId } as SocketUser;

    if (account.role === 'SUPPLIER') {
      const supplier = await prisma.supplier.findFirst({
        where: { userId: account.id, deletedAt: null },
        select: { id: true, outletId: true },
      });
      socket.data.supplierId = supplier?.id || null;
      socket.data.supplierOutletId = supplier?.outletId || null;
    }
    return next();
  } catch (error) {
    logger.error(`Socket authentication failed: ${(error as Error)?.message || error}`);
    return next(new Error('UNAUTHORIZED'));
  }
}

async function joinOutletRooms(socket: Socket, outletId: string) {
  const user = socket.data.user as SocketUser;
  if (!(await canAccessOutlet(user, outletId, socket.data.supplierOutletId))) {
    logger.warn(`Socket ${socket.id} (user ${user.id}) denied outlet room ${outletId}`);
    return;
  }
  socket.join(`outlet:${outletId}`);
  socket.join(`role:${user.role}:outlet:${outletId}`);
}

export function registerSocketHandlers(socket: Socket) {
  const user = socket.data.user as SocketUser;
  logger.info(`Socket client connected: ${socket.id} (user: ${user.id}, role: ${user.role})`);

  // Rooms derived from the verified identity only
  socket.join(`user:${user.id}`);
  socket.join(`role:${user.role}`);
  if (user.businessId) {
    socket.join(`business:${user.businessId}`);
    socket.join(`role:${user.role}:business:${user.businessId}`);
  }
  if (socket.data.supplierId) {
    socket.join(`supplier:${socket.data.supplierId}`);
  }

  // Optional outlet requested by the client, verified like any REST request
  const requestedOutlet = socket.handshake.auth?.outletId;
  if (typeof requestedOutlet === 'string' && requestedOutlet) {
    joinOutletRooms(socket, requestedOutlet).catch(() => {});
  }

  socket.on('join_outlet', (targetOutletId: string) => {
    if (typeof targetOutletId === 'string' && targetOutletId) {
      joinOutletRooms(socket, targetOutletId).catch(() => {});
    }
  });

  socket.on('leave_outlet', (targetOutletId: string) => {
    if (typeof targetOutletId === 'string' && targetOutletId) {
      socket.leave(`outlet:${targetOutletId}`);
      socket.leave(`role:${user.role}:outlet:${targetOutletId}`);
    }
  });

  // Personal, business, role and supplier rooms are joined automatically above from the login.
  // Requests to join anyone else's are ignored (kept as no-ops for older clients).
  for (const event of ['join_user', 'join_business', 'join_role', 'join_supplier']) {
    socket.on(event, () => {});
  }

  socket.on('disconnect', () => {
    logger.info(`Socket client disconnected: ${socket.id}`);
  });
}

export function initSocket(httpServer: HTTPServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    authenticateSocket(socket, next);
  });
  io.on('connection', registerSocketHandlers);

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io is not initialized yet!');
  }
  return io;
}

export function emitNotificationToRooms(rooms: string[], payload: any) {
  if (!io) return;
  const uniqueRooms = Array.from(new Set(rooms.filter(Boolean)));
  if (uniqueRooms.length > 0) {
    io.to(uniqueRooms).emit('notification', payload);
  }
}

/**
 * Kitchen/order live update. Goes to the outlet's room, or — in "all outlets" mode — to the
 * business's room. Never broadcast to every connected client on the platform.
 */
export function emitKDSUpdate(outletId?: string, payload?: any, businessId?: string | null) {
  if (!io) return;
  const data = payload || { type: 'KDS_UPDATE', outletId: outletId || 'all', timestamp: Date.now() };
  if (outletId && outletId !== 'all') {
    io.to(`outlet:${outletId}`).emit('kds_update', data);
  } else if (businessId) {
    io.to(`business:${businessId}`).emit('kds_update', data);
  } else {
    logger.warn('emitKDSUpdate called without an outlet or business — update not sent');
  }
}
