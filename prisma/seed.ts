import {
  PrismaClient,
  Role,
  EmployeeStatus,
  TableType,
  TableStatus,
  StockReason,
  SubscriptionStatus,
  DayOfWeek,
  ShiftAssignmentStatus,
  WasteReasonType,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { generateRefreshToken } from '../src/utils/jwt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Hash password for all generated users (default: "Password@123")
  const passwordHash = bcrypt.hashSync('Password@123', 10);

  // 1. Clean existing records in reverse dependency order
  console.log('🧹 Cleaning existing data...');
  await prisma.stockLedgerEntry.deleteMany();
  await prisma.stockBatch.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.item.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.order.deleteMany();
  await prisma.tableToken.deleteMany();
  await prisma.table.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.wasteLog.deleteMany();
  await prisma.dailySalesSummary.deleteMany();
  await prisma.staffQuery.deleteMany();
  await prisma.ticketHistory.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.shiftAssignment.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.shiftSwapRequest.deleteMany();
  await prisma.employeeRoster.deleteMany();
  await prisma.outletHoliday.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.employeeDocument.deleteMany();
  await prisma.performanceNote.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.userOutlet.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.businessOwner.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.outlet.deleteMany();
  await prisma.business.deleteMany();

  console.log('✨ Database cleaned.');

  // 2. Data Definitions for 5 Business Owners & Businesses
  const businessOwnersData = [
    {
      ownerName: 'Aquib Hingwala',
      ownerEmail: 'aquibhingwala@gmail.com',
      ownerPhone: '9876500001',
      businessName: 'Aroma Coffee Roasters',
      businessType: 'Café & Bakery',
      contactDetail: '+91 9876500001',
      outlets: [
        { name: 'Aroma Coffee - Downtown', address: '12 Floor, MG Road', city: 'Mumbai', state: 'Maharashtra' },
        { name: 'Aroma Coffee - Airport T2', address: 'Departure Gate 4, T2', city: 'Mumbai', state: 'Maharashtra' },
        { name: 'Aroma Coffee - Tech Park', address: 'Outer Ring Road, Manyata', city: 'Bengaluru', state: 'Karnataka' },
      ],
    },
    {
      ownerName: 'Alfred Verstappen',
      ownerEmail: 'verstapenalfred@gmail.com',
      ownerPhone: '9876500002',
      businessName: 'Spice & Dine Hospitality',
      businessType: 'Fine Dining',
      contactDetail: '+91 9876500002',
      outlets: [
        { name: 'Spice & Dine - MG Road', address: '45 MG Road Plaza', city: 'Bengaluru', state: 'Karnataka' },
        { name: 'Spice & Dine - Indiranagar', address: '100 Feet Road, 12th Main', city: 'Bengaluru', state: 'Karnataka' },
        { name: 'Spice & Dine - Jubilee Hills', address: 'Road No. 36', city: 'Hyderabad', state: 'Telangana' },
      ],
    },
    {
      ownerName: 'Nouman Khan',
      ownerEmail: 'noumankhan8097@gmail.com',
      ownerPhone: '9876500003',
      businessName: 'Urban Bite Bistro',
      businessType: 'Fast Casual',
      contactDetail: '+91 9876500003',
      outlets: [
        { name: 'Urban Bite - Connaught Place', address: 'Inner Circle, Block F', city: 'New Delhi', state: 'Delhi' },
        { name: 'Urban Bite - Cyber Hub', address: 'Ground Floor, Cyber Hub', city: 'Gurugram', state: 'Haryana' },
        { name: 'Urban Bite - Sector 18', address: 'Atta Market Complex', city: 'Noida', state: 'Uttar Pradesh' },
      ],
    },
    {
      ownerName: 'Abdul ST',
      ownerEmail: 'st.abdul24@gmail.com',
      ownerPhone: '9876500004',
      businessName: 'Royal Feast Restaurants',
      businessType: 'Multi-Cuisine',
      contactDetail: '+91 9876500004',
      outlets: [
        { name: 'Royal Feast - Park Street', address: '78 Park Street Avenue', city: 'Kolkata', state: 'West Bengal' },
        { name: 'Royal Feast - Salt Lake', address: 'Sector V, Electronic Complex', city: 'Kolkata', state: 'West Bengal' },
        { name: 'Royal Feast - Ballygunge', address: 'Gariahat Crossing', city: 'Kolkata', state: 'West Bengal' },
      ],
    },
    {
      ownerName: 'Braham Global Holdings',
      ownerEmail: 'brahamglobalholdings@gmail.com',
      ownerPhone: '9876500005',
      businessName: 'Ocean Breeze Eateries',
      businessType: 'Seafood & Restobar',
      contactDetail: '+91 9876500005',
      outlets: [
        { name: 'Ocean Breeze - Marine Drive', address: 'Marine Plaza promenade', city: 'Mumbai', state: 'Maharashtra' },
        { name: 'Ocean Breeze - Bandra West', address: 'Carter Road promenade', city: 'Mumbai', state: 'Maharashtra' },
        { name: 'Ocean Breeze - Juhu Beach', address: 'Juhu Tara Road', city: 'Mumbai', state: 'Maharashtra' },
      ],
    },
  ];

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

  const daysOfWeekList: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  let totalOutletsCreated = 0;
  let totalUsersCreated = 0;
  let totalEmployeesCreated = 0;
  let totalShiftsCreated = 0;
  let totalRostersCreated = 0;
  let totalAssignmentsCreated = 0;
  let totalSuppliersCreated = 0;
  let totalMenuCategoriesCreated = 0;
  let totalMenuItemsCreated = 0;
  let totalInventoryItemsCreated = 0;
  let totalTablesCreated = 0;
  let totalWasteLogsCreated = 0;

  // 3. Iterate over each business owner
  for (let bIndex = 0; bIndex < businessOwnersData.length; bIndex++) {
    const bData = businessOwnersData[bIndex];
    console.log(`\n🏢 Creating Business ${bIndex + 1}: "${bData.businessName}"`);

    // Create Business
    const business = await prisma.business.create({
      data: {
        name: bData.businessName,
        businessType: bData.businessType,
        contactDetail: bData.contactDetail,
        locationsCount: bData.outlets.length.toString(),
      },
    });

    // Create Subscription
    await prisma.subscription.create({
      data: {
        businessId: business.id,
        status: SubscriptionStatus.ACTIVE,
        planId: 'ENTERPRISE',
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    // Create Business Owner User
    const ownerUser = await prisma.user.create({
      data: {
        businessId: business.id,
        email: bData.ownerEmail,
        passwordHash,
        name: bData.ownerName,
        phoneNo: bData.ownerPhone,
        role: Role.BUSINESS_OWNER,
      },
    });
    totalUsersCreated++;

    await prisma.businessOwner.create({
      data: {
        userId: ownerUser.id,
        businessId: business.id,
      },
    });

    // Create Outlets for this Business
    for (let oIndex = 0; oIndex < bData.outlets.length; oIndex++) {
      const oData = bData.outlets[oIndex];
      const outletCode = `B${bIndex + 1}O${oIndex + 1}`;

      const outlet = await prisma.outlet.create({
        data: {
          businessId: business.id,
          name: oData.name,
          address: oData.address,
          city: oData.city,
          state: oData.state,
          country: 'India',
          cgstRateDecimal: 9.0,
          sgstRateDecimal: 9.0,
          operatingDays: JSON.stringify(daysOfWeekList),
        },
      });
      totalOutletsCreated++;

      await prisma.userOutlet.create({
        data: { userId: ownerUser.id, outletId: outlet.id },
      });

      // --- Shifts Seeding ---
      const morningShift = await prisma.shift.create({
        data: {
          outletId: outlet.id,
          name: 'Morning Shift',
          startTime: '08:00',
          endTime: '16:00',
        },
      });
      const eveningShift = await prisma.shift.create({
        data: {
          outletId: outlet.id,
          name: 'Evening Shift',
          startTime: '16:00',
          endTime: '00:00',
        },
      });
      totalShiftsCreated += 2;
      const outletShifts = [morningShift, eveningShift];

      // --- Staff Creation per Outlet ---
      // Structure: 1 Manager + 4 General Staff + 1 Kitchen Staff = 6 Staff members
      const allOutletEmployees = [];

      // A. Create 1 Manager
      const mgrUser = await prisma.user.create({
        data: {
          businessId: business.id,
          email: `manager.${outletCode.toLowerCase()}@alayn.com`,
          passwordHash,
          name: `Manager (${oData.name})`,
          phoneNo: `98000${bIndex + 1}${oIndex + 1}01`,
          role: Role.MANAGER,
        },
      });
      totalUsersCreated++;

      await prisma.userOutlet.create({ data: { userId: mgrUser.id, outletId: outlet.id } });

      const mgrEmp = await prisma.employee.create({
        data: {
          outletId: outlet.id,
          userId: mgrUser.id,
          email: mgrUser.email,
          name: mgrUser.name,
          phone: mgrUser.phoneNo,
          role: Role.MANAGER,
          joiningDate: new Date('2025-01-15'),
          status: EmployeeStatus.ACTIVE,
        },
      });
      allOutletEmployees.push(mgrEmp);
      totalEmployeesCreated++;

      // B. Create 4 General Staff
      const createdStaffEmployees = [];
      const staffTitles = ['Head Waiter', 'Senior Cashier', 'Order Captain', 'Service Staff'];
      for (let s = 0; s < 4; s++) {
        const staffUser = await prisma.user.create({
          data: {
            businessId: business.id,
            email: `staff.${outletCode.toLowerCase()}.${s + 1}@alayn.com`,
            passwordHash,
            name: `${staffTitles[s]} (${oData.city})`,
            phoneNo: `98000${bIndex + 1}${oIndex + 1}1${s + 1}`,
            role: Role.STAFF,
          },
        });
        totalUsersCreated++;

        await prisma.userOutlet.create({ data: { userId: staffUser.id, outletId: outlet.id } });

        const staffEmp = await prisma.employee.create({
          data: {
            outletId: outlet.id,
            userId: staffUser.id,
            email: staffUser.email,
            name: staffUser.name,
            phone: staffUser.phoneNo,
            role: Role.STAFF,
            joiningDate: new Date('2025-02-01'),
            status: EmployeeStatus.ACTIVE,
          },
        });
        createdStaffEmployees.push(staffEmp);
        allOutletEmployees.push(staffEmp);
        totalEmployeesCreated++;
      }

      // C. Create 1 Kitchen Staff
      const kitchenUser = await prisma.user.create({
        data: {
          businessId: business.id,
          email: `kitchen.${outletCode.toLowerCase()}@alayn.com`,
          passwordHash,
          name: `Chef (${oData.name})`,
          phoneNo: `98000${bIndex + 1}${oIndex + 1}99`,
          role: Role.KITCHEN,
        },
      });
      totalUsersCreated++;

      await prisma.userOutlet.create({ data: { userId: kitchenUser.id, outletId: outlet.id } });

      const kitchenEmp = await prisma.employee.create({
        data: {
          outletId: outlet.id,
          userId: kitchenUser.id,
          email: kitchenUser.email,
          name: kitchenUser.name,
          phone: kitchenUser.phoneNo,
          role: Role.KITCHEN,
          joiningDate: new Date('2025-02-01'),
          status: EmployeeStatus.ACTIVE,
        },
      });
      allOutletEmployees.push(kitchenEmp);
      totalEmployeesCreated++;

      // --- Employee Roster & Shift Assignments Seeding ---
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let eIdx = 0; eIdx < allOutletEmployees.length; eIdx++) {
        const emp = allOutletEmployees[eIdx];
        const assignedShift = outletShifts[eIdx % 2]; // Alternate Morning & Evening

        // Roster for all 7 days of week
        for (let d = 0; d < daysOfWeekList.length; d++) {
          const day = daysOfWeekList[d];
          // Grant Sunday off for half staff, Monday off for rest
          const isOffDay = (eIdx % 2 === 0 && day === 'SUNDAY') || (eIdx % 2 === 1 && day === 'MONDAY');

          await prisma.employeeRoster.create({
            data: {
              employeeId: emp.id,
              outletId: outlet.id,
              dayOfWeek: day,
              shiftId: isOffDay ? null : assignedShift.id,
            },
          });
          totalRostersCreated++;
        }

        // Shift Assignments for today, yesterday, and tomorrow
        for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
          const shiftDate = new Date(today);
          shiftDate.setDate(today.getDate() + dayOffset);

          await prisma.shiftAssignment.create({
            data: {
              employeeId: emp.id,
              outletId: outlet.id,
              shiftId: assignedShift.id,
              date: shiftDate,
              status: dayOffset < 0 ? ShiftAssignmentStatus.PRESENT : ShiftAssignmentStatus.ASSIGNED,
            },
          });
          totalAssignmentsCreated++;
        }
      }

      // --- Suppliers Seeding ---
      for (const supTpl of suppliersTemplate) {
        await prisma.supplier.create({
          data: {
            outletId: outlet.id,
            name: `${supTpl.name} (${oData.city})`,
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
            outletId: outlet.id,
          },
        });
        createdItemsMap[itemTpl.key] = item;
        totalInventoryItemsCreated++;

        await prisma.stockBatch.create({
          data: {
            itemId: item.id,
            outletId: outlet.id,
            quantity: itemTpl.initialQty,
            expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
            batchNumber: `BATCH-${sku}-01`,
            unitCostPaise: itemTpl.unitCostPaise,
          },
        });

        await prisma.stockLedgerEntry.create({
          data: {
            itemId: item.id,
            outletId: outlet.id,
            change: itemTpl.initialQty,
            reason: StockReason.PURCHASE,
            referenceId: `INITIAL-SEED-${sku}`,
          },
        });
      }

      // --- Menu Categories, Menu Items & Recipes Seeding ---
      for (const catTpl of menuTemplate) {
        const category = await prisma.menuCategory.create({
          data: {
            name: catTpl.categoryName,
            description: catTpl.description,
            isActive: true,
            outletId: outlet.id,
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
              dietaryType: (itemTpl as any).dietaryType || (itemTpl.isVeg ? 'VEG' : 'NON_VEG'),
              isActive: true,
              categoryId: category.id,
              outletId: outlet.id,
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

      // --- 10 Tables per Outlet Seeding ---
      for (let tNum = 1; tNum <= 10; tNum++) {
        const assignedStaff = createdStaffEmployees.length > 0
          ? (tNum <= 5 ? createdStaffEmployees[0] : (createdStaffEmployees[1] || createdStaffEmployees[0]))
          : null;

        await prisma.table.create({
          data: {
            tableNumber: tNum,
            tableType: tNum <= 5 ? TableType.AC : TableType.NON_AC,
            status: TableStatus.AVAILABLE,
            outletId: outlet.id,
            assignedStaffId: assignedStaff ? assignedStaff.id : null,
          },
        });
        totalTablesCreated++;
      }

      // --- Waste Logs Seeding ---
      if (createdItemsMap['milk']) {
        await prisma.wasteLog.create({
          data: {
            outletId: outlet.id,
            itemId: createdItemsMap['milk'].id,
            quantity: 2.0,
            costAtLoggingPaise: 12000,
            reason: WasteReasonType.SPOILAGE,
            loggedById: mgrUser.id,
          },
        });
        totalWasteLogsCreated++;
      }
      if (createdItemsMap['cheese']) {
        await prisma.wasteLog.create({
          data: {
            outletId: outlet.id,
            itemId: createdItemsMap['cheese'].id,
            quantity: 5.0,
            costAtLoggingPaise: 2500,
            reason: WasteReasonType.OVER_PREP,
            loggedById: mgrUser.id,
          },
        });
        totalWasteLogsCreated++;
      }
    }
  }

  // --- Seed Refresh Tokens for All Users ---
  console.log('\n🔑 Seeding refresh tokens for all created users...');
  const allCreatedUsers = await prisma.user.findMany({ where: { deletedAt: null } });
  let totalRefreshTokensCreated = 0;
  for (const user of allCreatedUsers) {
    const rawRefreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      businessId: user.businessId,
    });
    const refreshHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt,
      },
    });
    totalRefreshTokensCreated++;
  }

  console.log('\n================ SEED SUMMARY ================');
  console.log(`✅ Business Owners Created  : 5`);
  console.log(`✅ Businesses Created       : 5 (1 per owner)`);
  console.log(`✅ Outlets Created          : ${totalOutletsCreated} (3 per business)`);
  console.log(`✅ Users Created            : ${totalUsersCreated} (Owners, Managers, Staff, Kitchen)`);
  console.log(`✅ Refresh Tokens Seeded    : ${totalRefreshTokensCreated} (1 per user)`);
  console.log(`✅ Employees Created        : ${totalEmployeesCreated} (6 per outlet)`);
  console.log(`✅ Shifts Created           : ${totalShiftsCreated} (2 per outlet: Morning & Evening)`);
  console.log(`✅ Weekly Rosters Seeded    : ${totalRostersCreated} (7 days per employee)`);
  console.log(`✅ Shift Assignments        : ${totalAssignmentsCreated} (Recent & Upcoming shifts)`);
  console.log(`✅ Suppliers Seeded         : ${totalSuppliersCreated} (3 suppliers per outlet)`);
  console.log(`✅ Menu Categories          : ${totalMenuCategoriesCreated} (3 categories per outlet)`);
  console.log(`✅ Menu Items               : ${totalMenuItemsCreated} (6 items per outlet with Recipes)`);
  console.log(`✅ Inventory Items Seeded   : ${totalInventoryItemsCreated} (10 items x ${totalOutletsCreated} outlets)`);
  console.log(`✅ Tables Seeded            : ${totalTablesCreated} (10 tables x ${totalOutletsCreated} outlets)`);
  console.log(`✅ Waste Logs Seeded        : ${totalWasteLogsCreated} (Spoilage & Over-prep logs)`);
  console.log('===============================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
