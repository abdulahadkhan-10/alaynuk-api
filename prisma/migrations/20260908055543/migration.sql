-- CreateEnum
CREATE TYPE "OutletSubscriptionStatus" AS ENUM ('ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'USER_DROPPED');

-- CreateTable
CREATE TABLE "OutletSubscription" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "status" "OutletSubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "planCode" TEXT NOT NULL DEFAULT 'MONTHLY_STANDARD',
    "planName" TEXT NOT NULL DEFAULT 'Monthly Pro Plan',
    "monthlyFeePaise" INTEGER NOT NULL DEFAULT 199900,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 18.0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" UUID NOT NULL,
    "outletSubscriptionId" UUID,
    "outletId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "cfOrderId" TEXT NOT NULL,
    "cfPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "taxAmountPaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentStatus" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "paymentSessionId" TEXT,
    "cfSignature" TEXT,
    "paidAt" TIMESTAMP(3),
    "rawWebhookPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutletSubscription_outletId_key" ON "OutletSubscription"("outletId");

-- CreateIndex
CREATE INDEX "OutletSubscription_businessId_idx" ON "OutletSubscription"("businessId");

-- CreateIndex
CREATE INDEX "OutletSubscription_status_idx" ON "OutletSubscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_cfOrderId_key" ON "SubscriptionPayment"("cfOrderId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_outletId_idx" ON "SubscriptionPayment"("outletId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_businessId_idx" ON "SubscriptionPayment"("businessId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_paymentStatus_idx" ON "SubscriptionPayment"("paymentStatus");

-- AddForeignKey
ALTER TABLE "OutletSubscription" ADD CONSTRAINT "OutletSubscription_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletSubscription" ADD CONSTRAINT "OutletSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_outletSubscriptionId_fkey" FOREIGN KEY ("outletSubscriptionId") REFERENCES "OutletSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
