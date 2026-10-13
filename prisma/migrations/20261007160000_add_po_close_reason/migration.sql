-- AlterTable: record why/when a purchase order was cancelled or closed short
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "closedReason" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
