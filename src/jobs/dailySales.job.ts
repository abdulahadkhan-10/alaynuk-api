import { Queue, Worker } from 'bullmq';
import { prisma } from '../config/prisma';
import { redisConnection } from '../config/redis';
import { logger } from '../config/logger';

export const dailySalesQueue = new Queue('DailySalesQueue', {
  connection: redisConnection,
});

export async function calculateDailySales(targetDate: Date) {
  logger.info(`Running Daily Sales summary job for date: ${targetDate.toDateString()}...`);
  
  // Define day boundaries
  const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
  const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

  // Fetch all outlets
  const outlets = await prisma.outlet.findMany({ where: { deletedAt: null } });

  for (const outlet of outlets) {
    // 1. Fetch completed orders for this outlet on the target day
    const completedOrders = await prisma.order.findMany({
      where: {
        outletId: outlet.id,
        status: 'COMPLETED',
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        deletedAt: null,
      },
      include: {
        items: true,
      },
    });

    const orderCount = completedOrders.length;
    if (orderCount === 0) {
      // Upsert summary with zero metrics
      await prisma.dailySalesSummary.upsert({
        where: {
          outletId_date: {
            outletId: outlet.id,
            date: startOfDay,
          },
        },
        update: {
          grossSalesPaise: 0,
          cogsPaise: 0,
          grossProfitPaise: 0,
          orderCount: 0,
          itemBreakdownJson: '{}',
        },
        create: {
          outletId: outlet.id,
          date: startOfDay,
          grossSalesPaise: 0,
          cogsPaise: 0,
          grossProfitPaise: 0,
          orderCount: 0,
          itemBreakdownJson: '{}',
        },
      });
      continue;
    }

    let grossSalesPaise = 0;
    let cogsPaise = 0;
    const itemBreakdown: { [menuItemId: string]: number } = {};

    for (const order of completedOrders) {
      grossSalesPaise += order.totalPaise;

      for (const orderItem of order.items) {
        // Update item breakdown
        if (itemBreakdown[orderItem.menuItemId]) {
          itemBreakdown[orderItem.menuItemId] += orderItem.quantity;
        } else {
          itemBreakdown[orderItem.menuItemId] = orderItem.quantity;
        }

        // Calculate COGS contribution from recipes
        const recipes = await prisma.recipe.findMany({
          where: { menuItemId: orderItem.menuItemId },
          include: { item: true },
        });

        for (const recipe of recipes) {
          const qtyUsed = recipe.quantityPerUnit.toNumber() * orderItem.quantity;
          cogsPaise += Math.round(qtyUsed * recipe.item.unitCostPaise);
        }
      }
    }

    const grossProfitPaise = grossSalesPaise - cogsPaise;

    // Upsert summary record
    await prisma.dailySalesSummary.upsert({
      where: {
        outletId_date: {
          outletId: outlet.id,
          date: startOfDay,
        },
      },
      update: {
        grossSalesPaise,
        cogsPaise,
        grossProfitPaise,
        orderCount,
        itemBreakdownJson: JSON.stringify(itemBreakdown),
      },
      create: {
        outletId: outlet.id,
        date: startOfDay,
        grossSalesPaise,
        cogsPaise,
        grossProfitPaise,
        orderCount,
        itemBreakdownJson: JSON.stringify(itemBreakdown),
      },
    });

    logger.info(`Upserted Daily Sales Summary for Outlet: ${outlet.name} on ${startOfDay.toDateString()}`);
  }
}

// Register worker if not testing
if (process.env.NODE_ENV !== 'test') {
  new Worker(
    'DailySalesQueue',
    async (job) => {
      if (job.name === 'calculateDailySales') {
        const dateParam = job.data.date ? new Date(job.data.date) : new Date();
        // Shift back by 1 day if running nightly for the previous day
        await calculateDailySales(dateParam);
      }
    },
    { connection: redisConnection }
  );
}
