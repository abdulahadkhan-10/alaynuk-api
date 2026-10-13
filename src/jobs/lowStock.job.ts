import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/prisma';
import { redisConnection } from '../config/redis';
import { logger } from '../config/logger';

export const lowStockQueue = new Queue('LowStockQueue', {
  connection: redisConnection,
});

export async function checkLowStock() {
  logger.info('Running Low Stock check job...');
  const items = await prisma.item.findMany({
    where: { deletedAt: null },
  });

  for (const item of items) {
    const ledgerSum = await prisma.stockLedgerEntry.aggregate({
      where: { itemId: item.id },
      _sum: { change: true },
    });
    const currentStock = ledgerSum._sum.change ? ledgerSum._sum.change.toNumber() : 0;
    const threshold = item.reorderThreshold.toNumber();

    if (currentStock <= threshold) {
      // Check if an open alert already exists
      const existingAlert = await prisma.stockAlert.findFirst({
        where: {
          itemId: item.id,
          type: 'LOW_STOCK',
          status: 'OPEN',
        },
      });

      if (!existingAlert) {
        await prisma.stockAlert.create({
          data: {
            itemId: item.id,
            type: 'LOW_STOCK',
            message: `Stock level for ${item.name} (${currentStock} ${item.unit}) is below the threshold of ${threshold} ${item.unit}.`,
            status: 'OPEN',
            outletId: item.outletId,
          },
        });
        logger.warn(`Created LOW_STOCK alert for item: ${item.name}`);
      }
    }
  }
}

// Register worker if not testing
if (process.env.NODE_ENV !== 'test') {
  new Worker(
    'LowStockQueue',
    async (job) => {
      if (job.name === 'checkLowStock') {
        await checkLowStock();
      }
    },
    { connection: redisConnection }
  );
}
