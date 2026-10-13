import { prisma } from '../../config/prisma';
import { Prisma, SubscriptionStatus, OutletSubscriptionStatus, DiscountType } from '@prisma/client';
import { AppError } from '../../utils/AppError';

export class OutletRepository {
  async createOutlet(businessId: string, userId: string, data: {
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    couponCode?: string;
    kitchenMode?: string;
  }) {
    const { couponCode, ...outletFields } = data;

    return prisma.$transaction(async (tx) => {
      const outlet = await tx.outlet.create({
        data: {
          businessId,
          ...outletFields,
        },
      });

      await tx.userOutlet.create({
        data: {
          userId,
          outletId: outlet.id,
        },
      });

      // 1. Process promotional coupon if entered
      const normalizedCoupon = (couponCode || '').trim().toUpperCase();
      const promoExpiry = new Date('2026-12-31T23:59:59.999Z');
      let outletSub = null;

      if (normalizedCoupon) {
        // Check dynamic database coupon first
        const dbCoupon = await tx.coupon.findUnique({
          where: { code: normalizedCoupon },
        });

        if (dbCoupon) {
          if (!dbCoupon.isActive) {
            throw new AppError('INVALID_COUPON', 'This coupon code is currently disabled.', 400);
          }
          if (dbCoupon.expiresAt && dbCoupon.expiresAt <= new Date()) {
            throw new AppError('EXPIRED_COUPON', 'This coupon code has expired.', 400);
          }
          if (dbCoupon.usageLimit && dbCoupon.usageCount >= dbCoupon.usageLimit) {
            throw new AppError('COUPON_LIMIT_REACHED', 'This coupon code has reached its maximum redemption limit.', 400);
          }

          // If 100% Free VIP license
          if (dbCoupon.discountType === DiscountType.PERCENTAGE && Number(dbCoupon.discountValue) >= 100) {
            // If the admin set an expiry date on the coupon, use it. Otherwise, default to 1 year from now.
            const couponExpiry = dbCoupon.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            const planCode = `COUPON_${dbCoupon.code}`;
            const planLabel = dbCoupon.expiresAt
              ? `${dbCoupon.code} VIP Access (Free until ${dbCoupon.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})`
              : `${dbCoupon.code} VIP Access (100% Free)`;

            await tx.coupon.update({
              where: { id: dbCoupon.id },
              data: { usageCount: { increment: 1 } },
            });

            await tx.subscription.upsert({
              where: { businessId },
              create: {
                businessId,
                status: SubscriptionStatus.ACTIVE,
                planId: planCode,
                currentPeriodStart: new Date(),
                currentPeriodEnd: couponExpiry,
              },
              update: {
                status: SubscriptionStatus.ACTIVE,
                planId: planCode,
                currentPeriodStart: new Date(),
                currentPeriodEnd: couponExpiry,
              },
            });

            outletSub = await tx.outletSubscription.create({
              data: {
                outletId: outlet.id,
                businessId,
                status: OutletSubscriptionStatus.ACTIVE,
                planCode,
                planName: planLabel,
                monthlyFeePaise: 0,
                taxRatePercent: 0,
                currency: 'INR',
                currentPeriodStart: new Date(),
                currentPeriodEnd: couponExpiry,
                autoRenew: false,
              },
            });
          }
        } else if (normalizedCoupon === 'FIRST25') {
          // Enforce Global Limit: strictly maximum 25 outlets across the platform
          const totalCouponClaims = await tx.outletSubscription.count({
            where: { planCode: 'COUPON_FIRST25' },
          });

          if (totalCouponClaims >= 25) {
            throw new AppError(
              'COUPON_LIMIT_REACHED',
              'The FIRST25 promotion has reached its platform limit of 25 free outlets. Please select a subscription plan to launch this branch.',
              400
            );
          }

          // Enforce Business Limit: strictly 1 outlet per business can use FIRST25
          const existingBusinessCoupon = await tx.outletSubscription.findFirst({
            where: {
              businessId,
              planCode: 'COUPON_FIRST25',
            },
            include: { outlet: { select: { name: true } } },
          });

          if (existingBusinessCoupon) {
            const branchName = existingBusinessCoupon.outlet?.name || 'an existing branch';
            throw new AppError(
              'COUPON_ALREADY_USED',
              `Your business has already redeemed the FIRST25 promotion for "${branchName}". Each business is limited to 1 free promotional branch. Additional branches require a paid subscription.`,
              400
            );
          }

          // Create/update the business-level Subscription
          await tx.subscription.upsert({
            where: { businessId },
            create: {
              businessId,
              status: SubscriptionStatus.ACTIVE,
              planId: 'COUPON_FIRST25',
              currentPeriodStart: new Date(),
              currentPeriodEnd: promoExpiry,
            },
            update: {
              status: SubscriptionStatus.ACTIVE,
              planId: 'COUPON_FIRST25',
              currentPeriodStart: new Date(),
              currentPeriodEnd: promoExpiry,
            },
          });

          // Activate THIS specific outlet with free VIP license
          outletSub = await tx.outletSubscription.create({
            data: {
              outletId: outlet.id,
              businessId,
              status: OutletSubscriptionStatus.ACTIVE,
              planCode: 'COUPON_FIRST25',
              planName: 'FIRST25 Early Adopter (Free until Dec 2026)',
              monthlyFeePaise: 0,
              taxRatePercent: 0,
              currency: 'INR',
              currentPeriodStart: new Date(),
              currentPeriodEnd: promoExpiry,
              autoRenew: false,
            },
          });
        } else {
          throw new AppError('INVALID_COUPON', 'Invalid coupon code. Please check and try again.', 400);
        }
      }

      if (!outletSub) {
        // Standard Outlet Creation (no coupon or partial discount branch):
        // Each outlet requires its own subscription. New outlets start in PENDING_PAYMENT.
        outletSub = await tx.outletSubscription.create({
          data: {
            outletId: outlet.id,
            businessId,
            status: OutletSubscriptionStatus.PENDING_PAYMENT,
            planCode: 'MONTHLY_STANDARD',
            planName: 'Standard Monthly Pro',
            monthlyFeePaise: 199900,
            taxRatePercent: 18.0,
            currency: 'INR',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            autoRenew: true,
          },
        });
      }

      return {
        ...outlet,
        subscription: outletSub,
      };
    });
  }

  async getOutletsByBusiness(businessId: string) {
    return prisma.outlet.findMany({
      where: { businessId, deletedAt: null },
      include: {
        subscription: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getOutletsByUser(userId: string, businessId?: string) {
    return prisma.outlet.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        deletedAt: null,
        users: {
          some: { userId },
        },
      },
      include: {
        subscription: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getHolidays(outletId: string) {
    return prisma.outletHoliday.findMany({
      where: { outletId },
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(outletId: string, name: string, date: Date, applyToAllOutlets?: boolean) {
    if (applyToAllOutlets) {
      const currentOutlet = await prisma.outlet.findUnique({ where: { id: outletId } });
      if (currentOutlet) {
        const allOutlets = await prisma.outlet.findMany({
          where: { businessId: currentOutlet.businessId, deletedAt: null },
        });
        const promises = allOutlets.map((o) =>
          prisma.outletHoliday.upsert({
            where: { outletId_date: { outletId: o.id, date } },
            update: { name },
            create: { outletId: o.id, name, date },
          })
        );
        return Promise.all(promises);
      }
    }
    return prisma.outletHoliday.upsert({
      where: { outletId_date: { outletId, date } },
      update: { name },
      create: {
        outletId,
        name,
        date,
      },
    });
  }

  async deleteHoliday(outletId: string, id: string) {
    return prisma.outletHoliday.delete({
      where: { id },
    });
  }

  async updateOperatingDays(outletId: string, operatingDays: string[]) {
    return prisma.outlet.update({
      where: { id: outletId },
      data: {
        operatingDays: JSON.stringify(operatingDays),
      },
    });
  }

  async updateTaxRates(
    outletId: string,
    cgstRateDecimal: number,
    sgstRateDecimal: number,
    serviceTaxRateDecimal: number = 0,
    businessId?: string,
    gstRegistrationType?: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED'
  ) {
    const updateData: Record<string, any> = {
      cgstRateDecimal,
      sgstRateDecimal,
      serviceTaxRateDecimal,
      ...(gstRegistrationType ? { gstRegistrationType } : {}),
    };
    if (outletId === "all" && businessId) {
      return prisma.outlet.updateMany({
        where: { businessId, deletedAt: null },
        data: updateData,
      });
    }
    return prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
    });
  }

  async updateReceiptDetails(
    outletId: string,
    data: { phone?: string; gstin?: string; receiptTagline?: string; receiptFooter?: string; upiId?: string },
    businessId?: string
  ) {
    const updateData: Record<string, any> = {};
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.gstin !== undefined) updateData.gstin = data.gstin;
    if (data.receiptTagline !== undefined) updateData.receiptTagline = data.receiptTagline;
    if (data.receiptFooter !== undefined) updateData.receiptFooter = data.receiptFooter;
    if (data.upiId !== undefined) updateData.upiId = data.upiId;

    if (outletId === "all" && businessId) {
      return prisma.outlet.updateMany({
        where: { businessId, deletedAt: null },
        data: updateData,
      });
    }
    return prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
    });
  }

  async updateLocation(
    outletId: string,
    latitude: number,
    longitude: number,
    geofenceRadius: number,
    businessId?: string
  ) {
    const updateData: any = { latitude, longitude, geofenceRadius };
    
    if (outletId === "all" && businessId) {
      return prisma.outlet.updateMany({
        where: { businessId, deletedAt: null },
        data: updateData,
      });
    }
    return prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
    });
  }

  async updateAttendanceRules(
    outletId: string,
    data: { earlyBufferMinutes: number; lateGraceMinutes: number },
    businessId?: string
  ) {
    const updateData = {
      earlyBufferMinutes: data.earlyBufferMinutes,
      lateGraceMinutes: data.lateGraceMinutes,
    };

    if (outletId === "all" && businessId) {
      return prisma.outlet.updateMany({
        where: { businessId, deletedAt: null },
        data: updateData,
      });
    }
    return prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
    });
  }

  async updateKitchenMode(
    outletId: string,
    kitchenMode: string,
    businessId?: string
  ) {
    const updateData: Record<string, any> = { kitchenMode };

    if (outletId === "all" && businessId) {
      return prisma.outlet.updateMany({
        where: { businessId, deletedAt: null },
        data: updateData,
      });
    }
    return prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
    });
  }

  async deleteUnpaidOutlet(businessId: string, outletId: string) {
    const outlet = await prisma.outlet.findFirst({
      where: { id: outletId, businessId, deletedAt: null },
      include: { subscription: true }
    });

    if (!outlet) {
      throw new Error('Outlet not found');
    }

    if (outlet.subscription && outlet.subscription.status === 'ACTIVE') {
      throw new Error('Cannot delete an outlet with an active subscription');
    }

    // Clean up relation tables and delete outlet
    return prisma.$transaction(async (tx) => {
      await tx.userOutlet.deleteMany({ where: { outletId } });
      await tx.subscriptionPayment.deleteMany({ where: { outletId } });
      await tx.outletSubscription.deleteMany({ where: { outletId } });
      return tx.outlet.delete({ where: { id: outletId } });
    });
  }
}
