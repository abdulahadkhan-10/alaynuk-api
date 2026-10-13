-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "operatingDays" TEXT;

-- CreateTable
CREATE TABLE "OutletHoliday" (
    "id" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRoster" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "shiftId" UUID,
    "outletId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRoster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletHoliday_outletId_idx" ON "OutletHoliday"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletHoliday_outletId_date_key" ON "OutletHoliday"("outletId", "date");

-- CreateIndex
CREATE INDEX "EmployeeRoster_outletId_idx" ON "EmployeeRoster"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRoster_employeeId_dayOfWeek_key" ON "EmployeeRoster"("employeeId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "OutletHoliday" ADD CONSTRAINT "OutletHoliday_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoster" ADD CONSTRAINT "EmployeeRoster_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoster" ADD CONSTRAINT "EmployeeRoster_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRoster" ADD CONSTRAINT "EmployeeRoster_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
