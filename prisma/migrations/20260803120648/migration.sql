-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "serviceTaxPaise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "serviceTaxRateDecimal" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ALTER COLUMN "cgstRateDecimal" SET DEFAULT 2.5,
ALTER COLUMN "sgstRateDecimal" SET DEFAULT 2.5;
