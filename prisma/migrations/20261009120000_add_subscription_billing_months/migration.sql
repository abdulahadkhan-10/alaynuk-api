-- AlterTable: add billingMonths to SubscriptionPayment to ensure months are locked in the DB
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "billingMonths" INTEGER NOT NULL DEFAULT 1;
