import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { generateRefreshToken } from '../src/utils/jwt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting refresh token seeding for all users...');

  // 1. Fetch all active users
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      businessId: true,
    },
  });

  if (users.length === 0) {
    console.log('⚠️ No users found in database. Please run database seed first (`npm run seed`).');
    return;
  }

  console.log(`👤 Found ${users.length} users. Generating refresh tokens...`);

  // 2. Clear old refresh tokens
  await prisma.refreshToken.deleteMany();
  console.log('🧹 Cleared existing refresh tokens from database.');

  const seededTokens: Array<{ email: string; role: string; refreshToken: string }> = [];

  // 3. Create fresh refresh token for each user
  for (const user of users) {
    const rawRefreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      businessId: user.businessId,
    });

    const refreshHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt,
      },
    });

    seededTokens.push({
      email: user.email,
      role: user.role,
      refreshToken: rawRefreshToken,
    });
  }

  console.log('\n================ SEEDED REFRESH TOKENS ================');
  console.log(`✅ Successfully seeded refresh tokens for ${seededTokens.length} users.\n`);

  console.log('User Tokens Summary:');
  seededTokens.forEach((t, i) => {
    console.log(`[${i + 1}] User: ${t.email} (${t.role})`);
    console.log(`    Refresh Token: ${t.refreshToken}\n`);
  });
  console.log('========================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Refresh token seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
