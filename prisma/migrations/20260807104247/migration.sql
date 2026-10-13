-- CreateEnum
CREATE TYPE "DietaryType" AS ENUM ('VEG', 'NON_VEG', 'VEGAN');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "dietaryType" "DietaryType" NOT NULL DEFAULT 'VEG';
