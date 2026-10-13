/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `Supplier` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('ONLINE', 'OFFLINE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "POStatus" ADD VALUE 'PACKING';
ALTER TYPE "POStatus" ADD VALUE 'PARTIALLY_DISPATCHED';
ALTER TYPE "POStatus" ADD VALUE 'DISPATCHED';
ALTER TYPE "POStatus" ADD VALUE 'OUT_OF_STOCK';
ALTER TYPE "POStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPPLIER';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "dispatchDate" TIMESTAMP(3),
ADD COLUMN     "expectedNextDeliveryDate" TIMESTAMP(3),
ADD COLUMN     "supplierNotes" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "damagedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "dispatchedQuantity" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "type" "SupplierType" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "userId" UUID;

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_userId_key" ON "Supplier"("userId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
