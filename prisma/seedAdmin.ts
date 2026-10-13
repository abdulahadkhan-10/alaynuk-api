import { PrismaClient, Role, DiscountType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🔒 Provisioning ALAYN Super Admin credentials...');

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@alayn.app').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@Alayn2026';
  const adminName = process.env.ADMIN_NAME || 'ALAYN Super Administrator';
  const adminPhone = process.env.ADMIN_PHONE || '9999999999';

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Upsert the SUPER_ADMIN user
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      name: adminName,
      role: Role.SUPER_ADMIN,
      phoneNo: adminPhone,
      businessId: null,
    },
    update: {
      passwordHash,
      role: Role.SUPER_ADMIN,
      name: adminName,
      phoneNo: adminPhone,
      deletedAt: null,
    },
  });

  console.log(`✅ Super Admin provisioned successfully:`);
  console.log(`   ID:    ${adminUser.id}`);
  console.log(`   Email: ${adminUser.email}`);
  console.log(`   Role:  ${adminUser.role}`);

  // Provision initial platform coupon: ALAYN20 (20% off)
  const existingCoupon = await prisma.coupon.findUnique({
    where: { code: 'ALAYN20' },
  });

  if (!existingCoupon) {
    const defaultExpiry = new Date();
    defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1); // 1 year validity

    await prisma.coupon.create({
      data: {
        code: 'ALAYN20',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20.0,
        isActive: true,
        expiresAt: defaultExpiry,
        usageLimit: 500,
        usageCount: 0,
        createdById: adminUser.id,
      },
    });
    console.log('✅ Initial promo coupon "ALAYN20" (20% OFF) provisioned.');
  } else {
    console.log('ℹ️ Promo coupon "ALAYN20" already exists.');
  }
}

main()
  .catch((e) => {
    console.error('❌ Error provisioning admin credentials:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
