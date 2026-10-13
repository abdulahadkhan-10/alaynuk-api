-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "assignedStaffId" UUID;

-- CreateIndex
CREATE INDEX "Table_assignedStaffId_idx" ON "Table"("assignedStaffId");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
