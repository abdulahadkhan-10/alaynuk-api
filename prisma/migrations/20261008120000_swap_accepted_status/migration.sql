-- AlterEnum: the colleague receiving a swapped shift must accept before a manager can approve
ALTER TYPE "SwapStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
