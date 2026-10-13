-- AlterTable: login accounts can now be disabled (employee set INACTIVE or removed)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Backfill: employees who were already set INACTIVE / deleted before this change lose login access now.
-- Original business owners and super admins are never disabled automatically.
UPDATE "User" u
SET "isActive" = false
WHERE u."role" <> 'SUPER_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM "BusinessOwner" bo WHERE bo."userId" = u."id")
  AND EXISTS (SELECT 1 FROM "Employee" e WHERE e."userId" = u."id")
  AND NOT EXISTS (
    SELECT 1 FROM "Employee" e
    WHERE e."userId" = u."id" AND e."deletedAt" IS NULL AND e."status" = 'ACTIVE'
  );
