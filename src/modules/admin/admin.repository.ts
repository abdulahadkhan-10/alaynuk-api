import { PrismaClient, Prisma, DiscountType } from '@prisma/client';

const prisma = new PrismaClient();

export class AdminRepository {
  async getDashboardMetrics() {
    const now = new Date();

    const [
      totalOutlets,
      totalBranches,
      activeBranches,
      totalCoupons,
      activeCoupon,
      recentOutlets,
    ] = await Promise.all([
      prisma.business.count({
        where: { deletedAt: null },
      }),
      prisma.outlet.count({
        where: { deletedAt: null },
      }),
      prisma.outletSubscription.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { gt: now },
        },
      }),
      prisma.coupon.count(),
      prisma.coupon.findFirst({
        where: {
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.business.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { outlets: { where: { deletedAt: null } } },
          },
        },
      }),
    ]);

    return {
      totalOutlets,
      totalBranches,
      activeBranches,
      totalCoupons,
      activeCoupon: activeCoupon
        ? {
            id: activeCoupon.id,
            code: activeCoupon.code,
            discountType: activeCoupon.discountType,
            discountValue: Number(activeCoupon.discountValue),
            expiresAt: activeCoupon.expiresAt,
            usageCount: activeCoupon.usageCount,
            usageLimit: activeCoupon.usageLimit,
          }
        : null,
      recentOutlets: recentOutlets.map((b) => ({
        id: b.id,
        name: b.name,
        businessType: b.businessType,
        branchCount: b._count.outlets,
        createdAt: b.createdAt,
      })),
    };
  }

  async getBusinesses(page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.BusinessWhereInput = {
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { businessType: { contains: search, mode: 'insensitive' } },
              { contactDetail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, businesses] = await Promise.all([
      prisma.business.count({ where }),
      prisma.business.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { outlets: { where: { deletedAt: null } } },
          },
          owners: {
            take: 1,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phoneNo: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: businesses.map((b) => {
        const ownerUser = b.owners[0]?.user;
        return {
          id: b.id,
          name: b.name,
          businessType: b.businessType || 'Hospitality',
          contactDetail: b.contactDetail || ownerUser?.phoneNo || '',
          branchCount: b._count.outlets,
          createdAt: b.createdAt,
          owner: ownerUser
            ? {
                id: ownerUser.id,
                name: ownerUser.name,
                email: ownerUser.email,
                phone: ownerUser.phoneNo,
              }
            : null,
        };
      }),
    };
  }

  async getBusinessById(id: string) {
    return prisma.business.findFirst({
      where: { id, deletedAt: null },
      include: {
        owners: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phoneNo: true,
                createdAt: true,
              },
            },
          },
        },
        outlets: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            subscription: true,
            _count: {
              select: {
                tables: { where: { deletedAt: null } },
                employees: { where: { deletedAt: null } },
                orders: true,
              },
            },
          },
        },
      },
    });
  }

  async getCoupons(
    page: number = 1,
    limit: number = 20,
    status: 'ALL' | 'ACTIVE' | 'DISABLED' | 'EXPIRED' = 'ALL',
    search?: string
  ) {
    const skip = (page - 1) * limit;
    const now = new Date();

    const where: Prisma.CouponWhereInput = {};

    if (search) {
      where.code = { contains: search.toUpperCase() };
    }

    if (status === 'ACTIVE') {
      where.isActive = true;
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
    } else if (status === 'DISABLED') {
      where.isActive = false;
    } else if (status === 'EXPIRED') {
      where.expiresAt = { lte: now };
    }

    const [total, coupons] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items: coupons.map((c) => {
        let computedStatus: 'ACTIVE' | 'DISABLED' | 'EXPIRED' = 'ACTIVE';
        if (!c.isActive) {
          computedStatus = 'DISABLED';
        } else if (c.expiresAt && c.expiresAt <= now) {
          computedStatus = 'EXPIRED';
        }

        return {
          id: c.id,
          code: c.code,
          discountType: c.discountType,
          discountValue: Number(c.discountValue),
          status: computedStatus,
          isActive: c.isActive,
          expiresAt: c.expiresAt,
          usageLimit: c.usageLimit,
          usageCount: c.usageCount,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          createdBy: c.createdBy
            ? {
                id: c.createdBy.id,
                name: c.createdBy.name,
                email: c.createdBy.email,
              }
            : null,
        };
      }),
    };
  }

  async getCouponByCode(code: string) {
    return prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
  }

  async getCouponById(id: string) {
    return prisma.coupon.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async createCoupon(data: {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    isActive?: boolean;
    expiresAt?: Date | null;
    usageLimit?: number | null;
    createdById?: string | null;
  }) {
    return prisma.coupon.create({
      data: {
        code: data.code.trim().toUpperCase(),
        discountType: data.discountType,
        discountValue: new Prisma.Decimal(data.discountValue),
        isActive: data.isActive ?? true,
        expiresAt: data.expiresAt ?? null,
        usageLimit: data.usageLimit ?? null,
        createdById: data.createdById ?? null,
      },
    });
  }

  async updateCoupon(
    id: string,
    data: {
      discountType?: DiscountType;
      discountValue?: number;
      isActive?: boolean;
      expiresAt?: Date | null;
      usageLimit?: number | null;
    }
  ) {
    const updatePayload: Prisma.CouponUpdateInput = {};

    if (data.discountType !== undefined) updatePayload.discountType = data.discountType;
    if (data.discountValue !== undefined) updatePayload.discountValue = new Prisma.Decimal(data.discountValue);
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.expiresAt !== undefined) updatePayload.expiresAt = data.expiresAt;
    if (data.usageLimit !== undefined) updatePayload.usageLimit = data.usageLimit;

    return prisma.coupon.update({
      where: { id },
      data: updatePayload,
    });
  }

  async deleteCoupon(id: string) {
    // Soft toggle isActive or remove if no payments attached
    const paymentsCount = await prisma.subscriptionPayment.count({
      where: { couponId: id },
    });

    if (paymentsCount > 0) {
      return prisma.coupon.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return prisma.coupon.delete({
      where: { id },
    });
  }
}
export default AdminRepository;
