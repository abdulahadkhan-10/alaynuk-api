-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "receiptFooter" TEXT,
ADD COLUMN     "receiptTagline" TEXT,
ADD COLUMN     "upiId" TEXT;
