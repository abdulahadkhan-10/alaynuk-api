-- CreateEnum
CREATE TYPE "TableType" AS ENUM ('AC', 'NON_AC');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED');

-- AlterTable
ALTER TABLE "TableToken" ADD COLUMN     "tableId" UUID;

-- CreateTable
CREATE TABLE "Table" (
    "id" UUID NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "tableType" "TableType" NOT NULL DEFAULT 'NON_AC',
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "outletId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Table_outletId_idx" ON "Table"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_outletId_tableNumber_key" ON "Table"("outletId", "tableNumber");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableToken" ADD CONSTRAINT "TableToken_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;
