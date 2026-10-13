import {
  PrismaClient,
  Role,
  EmployeeStatus,
  DayOfWeek,
  ShiftAssignmentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { generateRefreshToken } from '../src/utils/jwt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting San Churro database seeding...');

  // Hash password for all generated users (default: "Password@123")
  const passwordHash = bcrypt.hashSync('Password@123', 10);
  const daysOfWeekList: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  // 1. Create Business
  console.log('🏢 Creating Business: San Churro');
  const business = await prisma.business.create({
    data: {
      name: 'San Churro',
      businessType: 'Café & Desserts',
      contactDetail: '+91 9800001111',
      locationsCount: '1',
    },
  });

  // 2. Create Subscription
  await prisma.subscription.create({
    data: {
      businessId: business.id,
      status: SubscriptionStatus.ACTIVE,
      planId: 'ENTERPRISE',
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // 3. Create Business Owner
  const ownerUser = await prisma.user.create({
    data: {
      businessId: business.id,
      email: 'owner.sanchurro@alayn.com',
      passwordHash,
      name: 'San Churro Owner',
      phoneNo: '9800001111',
      role: Role.BUSINESS_OWNER,
    },
  });

  await prisma.businessOwner.create({
    data: {
      userId: ownerUser.id,
      businessId: business.id,
    },
  });

  // 4. Create Outlet
  const outlet = await prisma.outlet.create({
    data: {
      businessId: business.id,
      name: 'San Churro - Main Branch',
      address: '123 Dessert Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      cgstRateDecimal: 9.0,
      sgstRateDecimal: 9.0,
      operatingDays: JSON.stringify(daysOfWeekList),
    },
  });

  await prisma.userOutlet.create({
    data: { userId: ownerUser.id, outletId: outlet.id },
  });

  // 5. Create Shifts
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
  const outletShifts = [morningShift, eveningShift];

  const allOutletEmployees = [];

  // 6. Create 1 Manager
  console.log('👤 Creating 1 Manager...');
  const mgrUser = await prisma.user.create({
    data: {
      businessId: business.id,
      email: `manager.sanchurro@alayn.com`,
      passwordHash,
      name: `Manager (San Churro)`,
      phoneNo: `9800001112`,
      role: Role.MANAGER,
    },
  });
  await prisma.userOutlet.create({ data: { userId: mgrUser.id, outletId: outlet.id } });
  const mgrEmp = await prisma.employee.create({
    data: {
      outletId: outlet.id,
      userId: mgrUser.id,
      email: mgrUser.email,
      name: mgrUser.name,
      phone: mgrUser.phoneNo,
      role: Role.MANAGER,
      joiningDate: new Date(),
      status: EmployeeStatus.ACTIVE,
    },
  });
  allOutletEmployees.push(mgrEmp);

  // 7. Create 3 Staff members
  console.log('👤 Creating 3 Staff members...');
  for (let s = 1; s <= 3; s++) {
    const staffUser = await prisma.user.create({
      data: {
        businessId: business.id,
        email: `staff.sanchurro${s}@alayn.com`,
        passwordHash,
        name: `Staff ${s} (San Churro)`,
        phoneNo: `980000112${s}`,
        role: Role.STAFF,
      },
    });
    await prisma.userOutlet.create({ data: { userId: staffUser.id, outletId: outlet.id } });
    const staffEmp = await prisma.employee.create({
      data: {
        outletId: outlet.id,
        userId: staffUser.id,
        email: staffUser.email,
        name: staffUser.name,
        phone: staffUser.phoneNo,
        role: Role.STAFF,
        joiningDate: new Date(),
        status: EmployeeStatus.ACTIVE,
      },
    });
    allOutletEmployees.push(staffEmp);
  }

  // 8. Create 2 Kitchen Staff members
  console.log('👤 Creating 2 Kitchen Staff members...');
  for (let k = 1; k <= 2; k++) {
    const kitchenUser = await prisma.user.create({
      data: {
        businessId: business.id,
        email: `kitchen.sanchurro${k}@alayn.com`,
        passwordHash,
        name: `Chef ${k} (San Churro)`,
        phoneNo: `980000113${k}`,
        role: Role.KITCHEN,
      },
    });
    await prisma.userOutlet.create({ data: { userId: kitchenUser.id, outletId: outlet.id } });
    const kitchenEmp = await prisma.employee.create({
      data: {
        outletId: outlet.id,
        userId: kitchenUser.id,
        email: kitchenUser.email,
        name: kitchenUser.name,
        phone: kitchenUser.phoneNo,
        role: Role.KITCHEN,
        joiningDate: new Date(),
        status: EmployeeStatus.ACTIVE,
      },
    });
    allOutletEmployees.push(kitchenEmp);
  }

  // 9. Employee Roster & Shift Assignments
  console.log('📅 Assigning rosters and shifts...');
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
    }
  }

  // 10. Generate Refresh Tokens
  console.log('🔑 Generating refresh tokens for all created users...');
  const sanChurroUsers = await prisma.user.findMany({ 
    where: { businessId: business.id, deletedAt: null } 
  });
  
  for (const user of sanChurroUsers) {
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
  }

  console.log('\n✅ San Churro successfully seeded without removing existing data!');
  console.log('================ SUMMARY ================');
  console.log('🏢 1 Business created (San Churro)');
  console.log('🏢 1 Outlet created');
  console.log('👤 1 Business Owner');
  console.log('👤 1 Manager');
  console.log('👤 3 Staff members');
  console.log('👤 2 Kitchen staff members');
  console.log('📅 Shifts and rosters assigned');
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
