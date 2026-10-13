import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/prisma';
import { redisConnection } from '../config/redis';
import { logger } from '../config/logger';

export const expiryQueue = new Queue('ExpiryQueue', {
  connection: redisConnection,
});

export async function checkExpiries() {
  logger.info('Running Stock Expiry check job...');
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7); // 7 days warning threshold

  const activeBatches = await prisma.stockBatch.findMany({
    where: {
      quantity: { gt: 0 },
      expiryDate: { lte: warningDate },
    },
    include: {
      item: true,
    },
  });

  for (const batch of activeBatches) {
    // Check if an open alert exists for this item and batch
    const msg = `Batch ${batch.batchNumber} of ${batch.item.name} is expiring on ${batch.expiryDate.toDateString()}`;
    const existingAlert = await prisma.stockAlert.findFirst({
      where: {
        itemId: batch.itemId,
        type: 'EXPIRY',
        status: 'OPEN',
        message: {
          contains: batch.batchNumber,
        },
      },
    });

    if (!existingAlert) {
      await prisma.stockAlert.create({
        data: {
          itemId: batch.itemId,
          type: 'EXPIRY',
          message: msg,
          status: 'OPEN',
          outletId: batch.outletId,
        },
      });
      logger.warn(`Created EXPIRY alert for item batch: ${batch.item.name} (${batch.batchNumber})`);
    }
  }
}

// Register worker if not testing
if (process.env.NODE_ENV !== 'test') {
  new Worker(
    'ExpiryQueue',
    async (job) => {
      if (job.name === 'checkExpiries') {
        await checkExpiries();
      }
    },
    { connection: redisConnection }
  );
}
