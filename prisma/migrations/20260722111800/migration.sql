-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_assignedStaffId_fkey";

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
