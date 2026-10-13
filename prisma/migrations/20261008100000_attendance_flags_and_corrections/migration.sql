-- AlterTable: separate attendance flags (late / left early / worked on holiday / extra shift / missed clock-out)
-- and manager corrections with an audit trail
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "isLate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "leftEarly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "workedOnHoliday" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "workedOnClosedDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "extraShift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "missedClockOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "editedById" UUID;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "editReason" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);

-- Backfill the new flags from the old single status column
UPDATE "Attendance" SET "isLate" = true WHERE "status" = 'LATE';
UPDATE "Attendance" SET "leftEarly" = true WHERE "status" = 'EARLY_DEPARTURE';
