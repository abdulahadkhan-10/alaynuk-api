import {
  PrismaClient,
  TableType,
  TableStatus,
  StockReason,
  WasteReasonType,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Adding Menu, Inventory, and Tables to San Churro...');

  // 1. Find San Churro Outlet
  const sanChurroBusiness = await prisma.business.findFirst({
    where: { name: 'San Churro' }
  });

  const sanChurroOutlet = await prisma.outlet.findFirst({
    where: { businessId: sanChurroBusiness!.id }
  });

  if (!sanChurroOutlet) {
    console.error('❌ San Churro outlet not found.');
    process.exit(1);
  }

  // --- CLEANUP PARTIAL SEEDS ---
  console.log('Cleaning up previous partial seeds for San Churro...');
  await prisma.recipe.deleteMany({ where: { menuItem: { outletId: sanChurroOutlet.id } } });
  await prisma.menuItem.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.menuCategory.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.stockLedgerEntry.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.stockBatch.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.item.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.supplier.deleteMany({ where: { outletId: sanChurroOutlet.id } });
  await prisma.table.deleteMany({ where: { outletId: sanChurroOutlet.id } });

  // Get San Churro Staff (to assign tables)
  const staffMembers = await prisma.employee.findMany({
    where: {
      outletId: sanChurroOutlet.id,
      role: 'STAFF'
    }
  });

  // Inventory Items Template
  const inventoryItemsTemplate = [
    { key: 'milk', name: 'Fresh Milk', skuPrefix: 'MILK', category: 'Dairy', unit: 'Liters', reorderThreshold: 10.0, unitCostPaise: 6000, initialQty: 50 },
    { key: 'coffee', name: 'Arabica Coffee Beans', skuPrefix: 'COFFEE', category: 'Beverages', unit: 'Kg', reorderThreshold: 5.0, unitCostPaise: 80000, initialQty: 20 },
    { key: 'tea', name: 'Assam Tea Leaves', skuPrefix: 'TEA', category: 'Beverages', unit: 'Kg', reorderThreshold: 3.0, unitCostPaise: 45000, initialQty: 15 },
    { key: 'sugar', name: 'Refined White Sugar', skuPrefix: 'SUGAR', category: 'Pantry', unit: 'Kg', reorderThreshold: 10.0, unitCostPaise: 4500, initialQty: 50 },
    { key: 'flour', name: 'All-Purpose Flour', skuPrefix: 'FLOUR', category: 'Pantry', unit: 'Kg', reorderThreshold: 15.0, unitCostPaise: 4000, initialQty: 100 },
    { key: 'cheese', name: 'Cheddar Cheese Slices', skuPrefix: 'CHEESE', category: 'Dairy', unit: 'Pcs', reorderThreshold: 50.0, unitCostPaise: 500, initialQty: 200 },
    { key: 'butter', name: 'Unsalted Butter', skuPrefix: 'BUTTER', category: 'Dairy', unit: 'Kg', reorderThreshold: 5.0, unitCostPaise: 55000, initialQty: 20 },
    { key: 'oil', name: 'Sunflower Cooking Oil', skuPrefix: 'OIL', category: 'Pantry', unit: 'Liters', reorderThreshold: 10.0, unitCostPaise: 14000, initialQty: 50 },
    { key: 'cups', name: 'Paper Beverage Cups (8oz)', skuPrefix: 'CUP', category: 'Supplies', unit: 'Pcs', reorderThreshold: 100.0, unitCostPaise: 300, initialQty: 1000 },
    { key: 'napkins', name: 'Tissue Napkins', skuPrefix: 'NAPKIN', category: 'Supplies', unit: 'Pcs', reorderThreshold: 200.0, unitCostPaise: 50, initialQty: 2000 },
  ];

  // Menu Categories and Items Template
  const menuTemplate = [
    {
      categoryName: 'Hot Beverages',
      description: 'Freshly brewed coffees and traditional teas',
      items: [
        { name: 'Classic Cappuccino', description: 'Rich espresso topped with velvety steamed milk foam', pricePaise: 18000, isVeg: true, dietaryType: 'VEG' as const, recipe: [{ itemKey: 'coffee', qty: 0.02 }, { itemKey: 'milk', qty: 0.15 }, { itemKey: 'sugar', qty: 0.01 }] },
        { name: 'Masala Chai', description: 'Traditional spiced Indian tea with fresh milk', pricePaise: 9000, isVeg: true, dietaryType: 'VEG' as const, recipe: [{ itemKey: 'tea', qty: 0.01 }, { itemKey: 'milk', qty: 0.1 }, { itemKey: 'sugar', qty: 0.015 }] },
        { name: 'Espresso Single Shot', description: 'Intense and fragrant dark roast coffee shot', pricePaise: 12000, isVeg: true, dietaryType: 'VEGAN' as const, recipe: [{ itemKey: 'coffee', qty: 0.015 }] },
      ],
    },
    {
      categoryName: 'Bakery & Snacks',
      description: 'Freshly baked savories, croissants, and sandwiches',
      items: [
        { name: 'Gourmet Cheese Sandwich', description: 'Toasted bread with melted cheddar and unsalted butter', pricePaise: 22000, isVeg: true, recipe: [{ itemKey: 'flour', qty: 0.1 }, { itemKey: 'cheese', qty: 2.0 }, { itemKey: 'butter', qty: 0.02 }] },
        { name: 'Butter Croissant', description: 'Flaky golden French pastry baked with premium butter', pricePaise: 15000, isVeg: true, recipe: [{ itemKey: 'flour', qty: 0.08 }, { itemKey: 'butter', qty: 0.04 }, { itemKey: 'sugar', qty: 0.01 }] },
      ],
    },
    {
      categoryName: 'Cold Beverages',
      description: 'Chilled coffees, iced teas, and refreshing drinks',
      items: [
        { name: 'Iced Caramel Latte', description: 'Chilled espresso poured over fresh cold milk and ice', pricePaise: 24000, isVeg: true, recipe: [{ itemKey: 'coffee', qty: 0.02 }, { itemKey: 'milk', qty: 0.2 }, { itemKey: 'sugar', qty: 0.02 }, { itemKey: 'cups', qty: 1 }] },
      ],
    },
  ];

  const suppliersTemplate = [
    { name: 'Amul Dairy Co-operative', contactPerson: 'Ramesh Patel', phone: '9825011223', email: 'orders@amuldairy.com', address: 'Anand, Gujarat', category: 'Dairy' },
    { name: 'BeanCrafters Coffee Ltd.', contactPerson: 'Sunita Sharma', phone: '9845033445', email: 'sales@beancrafters.in', address: 'Chikmagalur, Karnataka', category: 'Beverages' },
    { name: 'Metro Cash & Carry India', contactPerson: 'Vikram Verma', phone: '9811055667', email: 'b2b@metrocash.in', address: 'Industrial Area Phase II', category: 'Pantry & Groceries' },
  ];

  const outletCode = `B_SANCHURRO`;
  let totalSuppliersCreated = 0;
  let totalInventoryItemsCreated = 0;
  let totalMenuCategoriesCreated = 0;
  let totalMenuItemsCreated = 0;
  let totalTablesCreated = 0;

  // --- Suppliers Seeding ---
  console.log('Adding Suppliers...');
  for (const supTpl of suppliersTemplate) {
    await prisma.supplier.create({
      data: {
        outletId: sanChurroOutlet.id,
        name: `${supTpl.name} (San Churro)`,
        contactPerson: supTpl.contactPerson,
        phone: supTpl.phone,
        email: supTpl.email,
        address: supTpl.address,
        category: supTpl.category,
      },
    });
    totalSuppliersCreated++;
  }

  // --- Inventory Items Seeding ---
  console.log('Adding Inventory...');
  const createdItemsMap: Record<string, any> = {};
  for (const itemTpl of inventoryItemsTemplate) {
    const sku = `${itemTpl.skuPrefix}-${outletCode}`;
    const item = await prisma.item.create({
      data: {
        name: itemTpl.name,
        sku,
        category: itemTpl.category,
        unit: itemTpl.unit,
        reorderThreshold: itemTpl.reorderThreshold,
        unitCostPaise: itemTpl.unitCostPaise,
        outletId: sanChurroOutlet.id,
      },
    });
    createdItemsMap[itemTpl.key] = item;
    totalInventoryItemsCreated++;

    await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        outletId: sanChurroOutlet.id,
        quantity: itemTpl.initialQty,
        expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        batchNumber: `BATCH-${sku}-01`,
        unitCostPaise: itemTpl.unitCostPaise,
      },
    });

    await prisma.stockLedgerEntry.create({
      data: {
        itemId: item.id,
        outletId: sanChurroOutlet.id,
        change: itemTpl.initialQty,
        reason: StockReason.PURCHASE,
        referenceId: `INITIAL-SEED-${sku}`,
      },
    });
  }

  // --- Menu Categories, Menu Items & Recipes Seeding ---
  console.log('Adding Menu items & Recipes...');
  for (const catTpl of menuTemplate) {
    const category = await prisma.menuCategory.create({
      data: {
        name: catTpl.categoryName,
        description: catTpl.description,
        isActive: true,
        outletId: sanChurroOutlet.id,
      },
    });
    totalMenuCategoriesCreated++;

    for (const itemTpl of catTpl.items) {
      const menuItem = await prisma.menuItem.create({
        data: {
          name: itemTpl.name,
          description: itemTpl.description,
          pricePaise: itemTpl.pricePaise,
          isVeg: itemTpl.isVeg,
          isActive: true,
          categoryId: category.id,
          outletId: sanChurroOutlet.id,
        },
      });
      totalMenuItemsCreated++;

      // Link recipes to inventory items
      for (const ing of itemTpl.recipe) {
        const invItem = createdItemsMap[ing.itemKey];
        if (invItem) {
          await prisma.recipe.create({
            data: {
              menuItemId: menuItem.id,
              itemId: invItem.id,
              quantityPerUnit: ing.qty,
            },
          });
        }
      }
    }
  }

  // --- Tables Seeding ---
  console.log('Adding Tables...');
  for (let tNum = 1; tNum <= 10; tNum++) {
    // Round robin assignment of tables to the 3 staff members
    const assignedStaff = staffMembers.length > 0
      ? staffMembers[tNum % staffMembers.length]
      : null;

    await prisma.table.create({
      data: {
        tableNumber: tNum,
        tableType: tNum <= 5 ? TableType.AC : TableType.NON_AC,
        status: TableStatus.AVAILABLE,
        outletId: sanChurroOutlet.id,
        assignedStaffId: assignedStaff ? assignedStaff.id : null,
      },
    });
    totalTablesCreated++;
  }

  console.log('✅ San Churro Menu, Tables, and Inventory successfully seeded!');
  console.log('================ SUMMARY ================');
  console.log(`✅ Suppliers Seeded         : ${totalSuppliersCreated}`);
  console.log(`✅ Menu Categories          : ${totalMenuCategoriesCreated}`);
  console.log(`✅ Menu Items               : ${totalMenuItemsCreated}`);
  console.log(`✅ Inventory Items Seeded   : ${totalInventoryItemsCreated}`);
  console.log(`✅ Tables Seeded            : ${totalTablesCreated}`);
  console.log('=========================================');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
