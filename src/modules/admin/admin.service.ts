import { AdminRepository } from './admin.repository';
import { AppError } from '../../utils/AppError';
import { DiscountType } from '@prisma/client';

export class AdminService {
  private repository = new AdminRepository();

  async getDashboard() {
    return this.repository.getDashboardMetrics();
  }

  async getOutlets(page: number, limit: number, search?: string) {
    return this.repository.getBusinesses(page, limit, search);
  }

  async getOutletDetails(businessId: string) {
    const business = await this.repository.getBusinessById(businessId);
    if (!business) {
      throw new AppError('NOT_FOUND', 'Outlet enterprise not found', 404);
    }

    const branches = business.outlets.map((outlet) => {
      const isSubActive =
        outlet.subscription?.status === 'ACTIVE' &&
        new Date(outlet.subscription.currentPeriodEnd) > new Date();

      return {
        id: outlet.id,
        name: outlet.name,
        address: outlet.address,
        city: outlet.city,
        state: outlet.state,
        country: outlet.country,
        phone: outlet.phone,
        gstin: outlet.gstin,
        openingTime: outlet.openingTime,
        closingTime: outlet.closingTime,
        subscriptionStatus: outlet.subscription?.status || 'PENDING_PAYMENT',
        isSubscriptionActive: isSubActive,
        planName: outlet.subscription?.planName || 'Smart Branch Pro',
        currentPeriodEnd: outlet.subscription?.currentPeriodEnd || null,
        tablesCount: outlet._count.tables,
        staffCount: outlet._count.employees,
        ordersCount: outlet._count.orders,
        createdAt: outlet.createdAt,
      };
    });

    return {
      id: business.id,
      name: business.name,
      businessType: business.businessType || 'Hospitality',
      contactDetail: business.contactDetail,
      createdAt: business.createdAt,
      owner: business.owners[0]?.user
        ? {
            id: business.owners[0].user.id,
            name: business.owners[0].user.name,
            email: business.owners[0].user.email,
            phone: business.owners[0].user.phoneNo,
            registeredAt: business.owners[0].user.createdAt,
          }
        : null,
      totalBranches: branches.length,
      activeBranchesCount: branches.filter((b) => b.isSubscriptionActive).length,
      branches,
    };
  }

  async getCoupons(
    page: number,
    limit: number,
    status: 'ALL' | 'ACTIVE' | 'DISABLED' | 'EXPIRED',
    search?: string
  ) {
    return this.repository.getCoupons(page, limit, status, search);
  }

  async createCoupon(
    data: {
      code: string;
      discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
      discountValue: number;
      isActive?: boolean;
      expiresAt?: string | null;
      usageLimit?: number | null;
    },
    adminUserId?: string
  ) {
    const normalizedCode = data.code.trim().toUpperCase();

    const existing = await this.repository.getCouponByCode(normalizedCode);
    if (existing) {
      throw new AppError(
        'CONFLICT',
        `Coupon code "${normalizedCode}" already exists. Please choose a unique code.`,
        409
      );
    }

    if (data.discountType === 'PERCENTAGE' && data.discountValue > 100) {
      throw new AppError('BAD_REQUEST', 'Percentage discount cannot exceed 100%', 400);
    }

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new AppError('BAD_REQUEST', 'Coupon expiration date must be in the future', 400);
    }

    return this.repository.createCoupon({
      code: normalizedCode,
      discountType: data.discountType as DiscountType,
      discountValue: data.discountValue,
      isActive: data.isActive ?? true,
      expiresAt,
      usageLimit: data.usageLimit ?? null,
      createdById: adminUserId ?? null,
    });
  }

  async updateCoupon(
    id: string,
    data: {
      discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
      discountValue?: number;
      isActive?: boolean;
      expiresAt?: string | null;
      usageLimit?: number | null;
    }
  ) {
    const existing = await this.repository.getCouponById(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Coupon not found', 404);
    }

    if (
      (data.discountType === 'PERCENTAGE' || existing.discountType === 'PERCENTAGE') &&
      data.discountValue !== undefined &&
      data.discountValue > 100
    ) {
      throw new AppError('BAD_REQUEST', 'Percentage discount cannot exceed 100%', 400);
    }

    const expiresAt =
      data.expiresAt !== undefined
        ? data.expiresAt
          ? new Date(data.expiresAt)
          : null
        : undefined;

    return this.repository.updateCoupon(id, {
      discountType: data.discountType as DiscountType | undefined,
      discountValue: data.discountValue,
      isActive: data.isActive,
      expiresAt,
      usageLimit: data.usageLimit,
    });
  }

  async deleteCoupon(id: string) {
    const existing = await this.repository.getCouponById(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Coupon not found', 404);
    }

    return this.repository.deleteCoupon(id);
  }
}
export default AdminService;
