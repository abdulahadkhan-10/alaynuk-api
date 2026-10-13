/*
  Warnings:

  - Added the required column `city` to the `Outlet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `country` to the `Outlet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `state` to the `Outlet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phoneNo` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "city" TEXT NOT NULL,
ADD COLUMN     "country" TEXT NOT NULL,
ADD COLUMN     "state" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneNo" TEXT NOT NULL;
