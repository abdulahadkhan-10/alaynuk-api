-- Bill-level calculation: rate snapshots, round-off, voluntary service charge, GST registration type

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: Outlet
ALTER TABLE "Outlet" ADD COLUMN IF NOT EXISTS "gstRegistrationType" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR';

-- AlterTable: Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "roundOffPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cgstRate" DECIMAL(5,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sgstRate" DECIMAL(5,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "serviceChargeRate" DECIMAL(5,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "serviceChargeWaived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "serviceChargeWaivedById" UUID;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "serviceChargeWaiveReason" TEXT;

-- Data repair: bills with extra rounds lost the later rounds' service charge from the service-charge
-- line (it was still included in the tax total and grand total). Make the line match; totals unchanged.
UPDATE "Order"
SET "serviceTaxPaise" = "taxPaise" - "cgstPaise" - "sgstPaise"
WHERE "serviceTaxPaise" <> "taxPaise" - "cgstPaise" - "sgstPaise"
  AND "taxPaise" - "cgstPaise" - "sgstPaise" >= 0;
