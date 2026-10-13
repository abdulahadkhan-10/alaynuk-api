import { SubscriptionRepository } from './subscription.repository';
import { CashfreeService } from './cashfree.service';
import { AppError } from '../../utils/AppError';
import { OutletSubscriptionStatus, SubscriptionPaymentStatus, PrismaClient, DiscountType } from '@prisma/client';

export interface PlanConfig {
  planCode: string;
  name: string;
  description: string;
  monthlyFeePaise: number; // Base fee without GST
  gstRatePercent: number; // 18%
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, PlanConfig> = {
  MONTHLY_STANDARD: {
    planCode: 'MONTHLY_STANDARD',
    name: 'Alayn Smart Branch Pro',
    description: 'Complete operational suite for 1 physical restaurant branch',
    monthlyFeePaise: parseInt(process.env.OUTLET_MONTHLY_FEE_PAISE || '199900', 10), // ₹1,999
    gstRatePercent: 18.0,
    features: [
      'Unlimited POS Billing Counters & Table QR Tokens',
      'Real-time Kitchen Display System (KDS)',
      'Live Inventory & Multi-batch Expiry Management',
      'Staff Shifts, Geofenced Attendance & Rostering',
      'Real-time Sales Telemetry & Financial Analytics',
      'AI Menu & Recipe Costing Assistant',
      '24/7 Priority Support & Automated Data Backups'
    ]
  }
};

export class SubscriptionService {
  private repository = new SubscriptionRepository();
  private cashfree = new CashfreeService();
  private prisma = new PrismaClient();

  getPlans() {
    return Object.values(SUBSCRIPTION_PLANS).map((plan) => {
      const baseRupees = plan.monthlyFeePaise / 100;
      const gstRupees = Math.round((baseRupees * plan.gstRatePercent) / 100 * 100) / 100;
      const totalRupees = Math.round((baseRupees + gstRupees) * 100) / 100;

      return {
        ...plan,
        basePriceRupees: baseRupees,
        gstRupees: gstRupees,
        totalPayableRupees: totalRupees,
        totalPayablePaise: Math.round(totalRupees * 100)
      };
    });
  }

  async initiateOutletSubscription(
    businessId: string,
    userId: string,
    outletId: string,
    planCode: string = 'MONTHLY_STANDARD',
    customerInfo?: { name?: string; email?: string; phone?: string },
    months: number = 1,
    couponCode?: string
  ) {
    const plan = SUBSCRIPTION_PLANS[planCode] || SUBSCRIPTION_PLANS.MONTHLY_STANDARD;
    const validatedMonths = Math.max(1, Math.min(36, parseInt(String(months), 10) || 1));
    
    // Base amount before discount
    const rawBaseRupees = (plan.monthlyFeePaise / 100) * validatedMonths;

    // Apply Coupon if provided (Server-authoritative calculation)
    let appliedCoupon: any = null;
    let discountRupees = 0;

    if (couponCode && couponCode.trim()) {
      const normalized = couponCode.trim().toUpperCase();
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: normalized },
      });

      if (!coupon || !coupon.isActive) {
        throw new AppError('INVALID_COUPON', 'Invalid or inactive coupon code.', 400);
      }

      if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
        throw new AppError('EXPIRED_COUPON', 'This coupon code has expired.', 400);
      }

      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        throw new AppError('COUPON_LIMIT_REACHED', 'This coupon code has reached its maximum usage limit.', 400);
      }

      if (coupon.discountType === DiscountType.PERCENTAGE) {
        discountRupees = Math.round(((rawBaseRupees * Number(coupon.discountValue)) / 100) * 100) / 100;
      } else {
        discountRupees = Math.min(rawBaseRupees, Number(coupon.discountValue));
      }

      appliedCoupon = coupon;
    }

    const finalBaseRupees = Math.max(0, rawBaseRupees - discountRupees);
    const gstRupees = Math.round(((finalBaseRupees * plan.gstRatePercent) / 100) * 100) / 100;
    const totalRupees = Math.round((finalBaseRupees + gstRupees) * 100) / 100;
    const totalPaise = Math.round(totalRupees * 100);
    const gstPaise = Math.round(gstRupees * 100);
    const discountPaise = Math.round(discountRupees * 100);

    // Generate unique Cashfree order ID
    const shortOutletId = outletId.replace(/-/g, '').substring(0, 8);
    const cfOrderId = `ALAYN_SUB_${shortOutletId}_${Date.now()}`;

    const planNameWithDuration = validatedMonths === 1 
      ? plan.name 
      : validatedMonths === 12 
      ? `${plan.name} (Annual Plan)` 
      : `${plan.name} (${validatedMonths} Months)`;

    // Ensure pending subscription record exists
    const subRecord = await this.repository.createOrUpdateSubscription({
      outletId,
      businessId,
      status: OutletSubscriptionStatus.PENDING_PAYMENT,
      planCode: plan.planCode,
      planName: planNameWithDuration,
      monthlyFeePaise: plan.monthlyFeePaise,
    });

    // Format customer phone number to guarantee 10 digits (Cashfree requires valid 10-digit phone)
    let sanitizedPhone = customerInfo?.phone ? customerInfo.phone.replace(/\D/g, '') : '';
    if (sanitizedPhone.length > 10) {
      sanitizedPhone = sanitizedPhone.slice(-10);
    }
    if (sanitizedPhone.length < 10) {
      sanitizedPhone = '9876543210';
    }

    // Create Cashfree Order
    const cfOrder = await this.cashfree.createOrder({
      orderId: cfOrderId,
      orderAmount: totalRupees,
      orderCurrency: 'INR',
      customerDetails: {
        customerId: userId,
        customerName: customerInfo?.name || 'Restaurant Business Owner',
        customerEmail: customerInfo?.email || 'owner@alayn.app',
        customerPhone: sanitizedPhone
      },
      orderNotes: {
        outletId,
        businessId,
        planCode: plan.planCode,
        userId,
        months: String(validatedMonths),
        couponCode: appliedCoupon?.code || '',
      },
      orderMeta: {
        notifyUrl: process.env.CASHFREE_NOTIFY_URL || (process.env.API_BASE_URL ? `${process.env.API_BASE_URL}/api/v1/subscriptions/webhook/cashfree` : undefined)
      }
    });

    // Create SubscriptionPayment audit ledger record with locked billingMonths
    await this.repository.createPaymentRecord({
      outletId,
      businessId,
      outletSubscriptionId: subRecord.id,
      cfOrderId,
      amountPaise: totalPaise,
      taxAmountPaise: gstPaise,
      currency: 'INR',
      paymentSessionId: cfOrder.payment_session_id,
      paymentStatus: SubscriptionPaymentStatus.PENDING,
      couponId: appliedCoupon?.id,
      couponCode: appliedCoupon?.code,
      discountAmountPaise: discountPaise,
      billingMonths: validatedMonths,
    });

    return {
      orderId: cfOrderId,
      cfOrderId: cfOrder.cf_order_id,
      paymentSessionId: cfOrder.payment_session_id,
      orderAmountRupees: totalRupees,
      baseAmountRupees: finalBaseRupees,
      discountRupees,
      gstAmountRupees: gstRupees,
      currency: 'INR',
      months: validatedMonths,
      coupon: appliedCoupon
        ? {
            code: appliedCoupon.code,
            discountType: appliedCoupon.discountType,
            discountValue: Number(appliedCoupon.discountValue),
            discountRupees,
          }
        : null,
      plan: {
        code: plan.planCode,
        name: planNameWithDuration,
        features: plan.features
      }
    };
  }

  async verifyOutletPayment(cfOrderId: string) {
    const payment = await this.repository.getPaymentByOrderId(cfOrderId);
    if (!payment) {
      throw new AppError('NOT_FOUND', 'Payment session order not found.', 404);
    }

    if (payment.paymentStatus === SubscriptionPaymentStatus.SUCCESS) {
      return {
        status: 'PAID',
        message: 'Subscription is already active.',
        subscription: payment.outletSubscription,
        payment
      };
    }

    // Verify status with Cashfree PG
    const cfOrder = await this.cashfree.getOrder(cfOrderId);
    const paymentsList = await this.cashfree.getOrderPayments(cfOrderId);
    const successfulPayment = paymentsList.find((p) => p.payment_status === 'SUCCESS') || paymentsList[0];

    // Anti-fraud: Verify paid amount matches what was charged
    const expectedRupees = payment.amountPaise / 100;
    const paidRupees = Number(cfOrder.order_amount);
    if (paidRupees < expectedRupees) {
      console.error(`[SubscriptionService] Paid amount mismatch for order ${cfOrderId}: paid ₹${paidRupees}, expected ₹${expectedRupees}`);
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'Paid amount is less than the required subscription fee.', 400);
    }

    if (cfOrder.order_status === 'PAID' || successfulPayment?.payment_status === 'SUCCESS') {
      const result = await this.repository.markPaymentSuccess(cfOrderId, {
        cfPaymentId: successfulPayment?.cf_payment_id ? String(successfulPayment.cf_payment_id) : undefined,
        paymentMethod: successfulPayment?.payment_group || successfulPayment?.payment_method || 'UPI',
        rawPayload: cfOrder,
        paidAt: new Date()
      });

      return {
        status: 'PAID',
        message: 'Payment verified successfully. Branch subscription is now ACTIVE!',
        subscription: result.subscription,
        payment: result.payment
      };
    }

    if (cfOrder.order_status === 'EXPIRED' || cfOrder.order_status === 'TERMINATED') {
      await this.repository.markPaymentFailed(cfOrderId, cfOrder);
      throw new AppError('PAYMENT_FAILED', 'Payment order has expired or failed. Please try again.', 400);
    }

    return {
      status: 'PENDING',
      message: 'Payment is currently pending confirmation from Cashfree.',
      payment
    };
  }

  async handleCashfreeWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, payload: any) {
    const signature = (headers['x-webhook-signature'] || headers['x-cashfree-signature']) as string;
    const timestamp = (headers['x-webhook-timestamp'] || headers['x-cashfree-timestamp']) as string;

    // Security Guardrail 1: Mandatory cryptographic signature check on every webhook
    if (!signature || !timestamp) {
      console.warn('[Webhook] Rejected Cashfree webhook: Missing signature/timestamp headers.');
      throw new AppError('FORBIDDEN', 'Missing webhook signature headers', 403);
    }

    const isValid = this.cashfree.verifyWebhookSignature(rawBody, timestamp, signature);
    if (!isValid) {
      console.warn('[Webhook] Invalid Cashfree signature rejected.');
      throw new AppError('FORBIDDEN', 'Invalid Webhook Signature', 403);
    }

    const eventType = payload?.type || payload?.event;
    const orderData = payload?.data?.order || payload?.data;
    const paymentData = payload?.data?.payment;

    const cfOrderId = orderData?.order_id || paymentData?.order_id;
    if (!cfOrderId) {
      return { received: true, ignored: true, reason: 'No order_id in webhook payload' };
    }

    // Security Guardrail 2: Server-to-Server Direct Verification
    // Do not trust incoming webhook payload alone. Query Cashfree API directly to verify payment!
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || eventType === 'ORDER_PAID_SUCCESS' || paymentData?.payment_status === 'SUCCESS') {
      const verification = await this.verifyOutletPayment(cfOrderId);
      return { success: true, processed: true, status: verification.status };
    }

    if (eventType === 'PAYMENT_FAILED_WEBHOOK' || paymentData?.payment_status === 'FAILED') {
      // Re-verify with Cashfree to ensure genuine failure before marking failed
      try {
        const cfOrder = await this.cashfree.getOrder(cfOrderId);
        if (cfOrder.order_status === 'PAID') {
          const verified = await this.verifyOutletPayment(cfOrderId);
          return { success: true, processed: true, status: verified.status };
        }
      } catch (err) {
        // Continue to mark payment failed if not found
      }

      await this.repository.markPaymentFailed(cfOrderId, payload);
      return { success: true, processed: true, status: 'FAILED' };
    }

    return { received: true };
  }

  async getOutletSubscriptionStatus(outletId: string) {
    const subscription = await this.repository.getSubscriptionByOutletId(outletId);
    if (!subscription) {
      return {
        hasSubscription: false,
        status: OutletSubscriptionStatus.PENDING_PAYMENT,
        isActive: false,
        daysRemaining: 0,
        currentPeriodEnd: null,
      };
    }

    const now = new Date();
    const periodEnd = new Date(subscription.currentPeriodEnd);
    const msRemaining = periodEnd.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    const isExpired = subscription.status === OutletSubscriptionStatus.EXPIRED || now > periodEnd;

    return {
      hasSubscription: true,
      subscriptionId: subscription.id,
      status: isExpired ? OutletSubscriptionStatus.EXPIRED : subscription.status,
      isActive: subscription.status === OutletSubscriptionStatus.ACTIVE && !isExpired,
      daysRemaining,
      planCode: subscription.planCode,
      planName: subscription.planName,
      monthlyFeeRupees: subscription.monthlyFeePaise / 100,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      recentPayments: subscription.payments
    };
  }

  async getBillingHistory(businessId: string) {
    const records = await this.repository.getBillingHistory(businessId);
    return records.map((rec) => ({
      id: rec.id,
      orderId: rec.cfOrderId,
      cfPaymentId: rec.cfPaymentId,
      outletId: rec.outletId,
      outletName: rec.outlet?.name || 'Branch Outlet',
      outletCity: rec.outlet?.city || '',
      amountRupees: rec.amountPaise / 100,
      taxRupees: rec.taxAmountPaise / 100,
      status: rec.paymentStatus,
      paymentMethod: rec.paymentMethod || 'UPI',
      paidAt: rec.paidAt || rec.createdAt,
      createdAt: rec.createdAt
    }));
  }

  async validateCoupon(code: string, businessId?: string) {
    const normalized = (code || '').trim().toUpperCase();

    // Check database for active coupon
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalized },
    });

    if (coupon) {
      if (!coupon.isActive) {
        return {
          valid: false,
          code: normalized,
          message: 'This coupon code is currently disabled.',
        };
      }

      if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
        return {
          valid: false,
          code: normalized,
          message: 'This coupon code has expired.',
        };
      }

      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        return {
          valid: false,
          code: normalized,
          message: 'This coupon code has reached its redemption limit.',
        };
      }

      const discountLabel =
        coupon.discountType === DiscountType.PERCENTAGE
          ? `${coupon.discountValue}% OFF`
          : `₹${coupon.discountValue} OFF`;

      return {
        valid: true,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
        description: `${discountLabel} on Alayn branch subscription`,
        validUntil: coupon.expiresAt?.toISOString() || null,
        message: `Coupon code "${coupon.code}" applied! You get ${discountLabel}.`,
      };
    }

    // Fallback: Legacy promotional code FIRST25
    if (normalized === 'FIRST25') {
      const { totalClaims, maxClaims, remainingSlots } = await this.repository.getCouponStats('COUPON_FIRST25');

      if (totalClaims >= maxClaims) {
        return {
          valid: false,
          code: 'FIRST25',
          totalClaims,
          maxClaims,
          remainingSlots: 0,
          message: 'The FIRST25 promotion has reached its platform limit of 25 outlets (0 remaining).',
        };
      }

      if (businessId) {
        const existingClaim = await this.repository.getBusinessCouponClaim(businessId, 'COUPON_FIRST25');
        if (existingClaim) {
          const branchName = existingClaim.outlet?.name || 'an existing branch';
          return {
            valid: false,
            code: 'FIRST25',
            totalClaims,
            maxClaims,
            remainingSlots,
            message: `Your business has already redeemed FIRST25 for "${branchName}". Each business is limited to 1 promotional branch.`,
          };
        }
      }

      return {
        valid: true,
        code: 'FIRST25',
        description: '100% Free VIP Access to Alayn through December 2026',
        discountPercent: 100,
        validUntil: '2026-12-31T23:59:59.999Z',
        totalClaims,
        maxClaims,
        remainingSlots,
        message: `${remainingSlots} of ${maxClaims} early adopter licenses remaining.`,
      };
    }

    return {
      valid: false,
      code: normalized,
      message: 'Invalid coupon code. Please check and try again.',
    };
  }

  async applyCoupon(businessId: string, couponCode: string, outletId?: string) {
    const normalized = (couponCode || '').trim().toUpperCase();
    if (!normalized) {
      throw new AppError('VALIDATION_ERROR', 'Coupon code is required.', 400);
    }

    // 1. Legacy FIRST25 promo code handler
    if (normalized === 'FIRST25') {
      const expiryDate = new Date('2026-12-31T23:59:59.999Z');
      const result = await this.repository.applyPromotionalCoupon(businessId, 'COUPON_FIRST25', expiryDate, outletId);

      return {
        success: true,
        message: 'FIRST25 coupon applied successfully! You now have 100% free VIP access through December 2026.',
        couponCode: 'FIRST25',
        validUntil: expiryDate.toISOString(),
        discountType: 'PERCENTAGE',
        discountValue: 100,
        ...result,
      };
    }

    // 2. Dynamic database coupon handler
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalized },
    });

    if (!coupon || !coupon.isActive) {
      throw new AppError('INVALID_COUPON', 'Invalid or inactive coupon code.', 400);
    }

    if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
      throw new AppError('EXPIRED_COUPON', 'This coupon code has expired.', 400);
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      throw new AppError('COUPON_LIMIT_REACHED', 'This coupon code has reached its maximum redemption limit.', 400);
    }

    const discountVal = Number(coupon.discountValue);

    // If it is a 100% FREE VIP coupon
    if (coupon.discountType === DiscountType.PERCENTAGE && discountVal >= 100) {
      const expiryDate = coupon.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const planCode = `COUPON_${coupon.code}`;

      const result = await this.repository.applyPromotionalCoupon(businessId, planCode, expiryDate, outletId);

      // Increment usage count
      await this.prisma.coupon.update({
        where: { id: coupon.id },
        data: { usageCount: { increment: 1 } },
      });

      return {
        success: true,
        message: `Coupon "${coupon.code}" applied! You now have 100% free VIP access.`,
        couponCode: coupon.code,
        validUntil: expiryDate.toISOString(),
        discountType: coupon.discountType,
        discountValue: discountVal,
        ...result,
      };
    }

    // For partial discount coupons (e.g., 20% OFF, ₹500 OFF)
    const discountLabel =
      coupon.discountType === DiscountType.PERCENTAGE
        ? `${discountVal}% OFF`
        : `₹${discountVal} OFF`;

    return {
      success: true,
      applied: true,
      message: `Coupon "${coupon.code}" applied! You get ${discountLabel} discount. Please proceed to payment with the discount applied.`,
      couponCode: coupon.code,
      discountType: coupon.discountType,
      discountValue: discountVal,
    };
  }
}
export default SubscriptionService;
