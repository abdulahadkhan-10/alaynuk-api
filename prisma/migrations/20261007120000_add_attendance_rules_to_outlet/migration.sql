-- AlterTable: attendance rules are now stored per outlet instead of in the client browser
ALTER TABLE "Outlet" ADD COLUMN IF NOT EXISTS "earlyBufferMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Outlet" ADD COLUMN IF NOT EXISTS "lateGraceMinutes" INTEGER NOT NULL DEFAULT 30;
