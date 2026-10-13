import { prisma } from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { Prisma, Role, SubscriptionStatus } from "@prisma/client";

export class AuthRepository {

  async registerOwner(data: {
    user: {
      name: string;
      email: string;
      passwordHash: string;
      phoneNo: string;
    };

    business: {
      name: string;
      locationsCount: string;
      businessType: string;
      contactDetail: string;
    };

    couponCode?: string;
  }) {

    return prisma.$transaction(async (tx) => {

      // 1. Create Business

      const business = await tx.business.create({
        data: {
          name: data.business.name,
          locationsCount: data.business.locationsCount,
          businessType: data.business.businessType,
          contactDetail: data.business.contactDetail,
        },
      });

      // 2. Create User

      const user = await tx.user.create({
        data: {
          businessId: business.id,
          name: data.user.name,
          email: data.user.email,
          passwordHash: data.user.passwordHash,
          phoneNo: data.user.phoneNo,
          role: Role.BUSINESS_OWNER,
        },
      });

      // 3. Create BusinessOwner link

      const businessOwner = await tx.businessOwner.create({
        data: {
          userId: user.id,
          businessId: business.id,
        },
      });

      // 4. If couponCode is FIRST25, grant free access until Dec 31, 2026
      let subscription = null;
      if (data.couponCode === 'FIRST25') {
        subscription = await tx.subscription.create({
          data: {
            businessId: business.id,
            status: SubscriptionStatus.ACTIVE,
            planId: 'COUPON_FIRST25',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date('2026-12-31T23:59:59.999Z'),
          },
        });
      }

      return {
        business,
        user,
        businessOwner,
        subscription,
      };
    });

  }


  async findUserByEmail(email: string) {
    return prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
      include: {
        business: {
          include: {
            subscription: true,
          },
        },
        businessOwner: true,
      },
    });
  }

  async findUserById(id: string) {
    return prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        business: {
          include: {
            subscription: true,
          },
        },
        businessOwner: true,
      },
    });
  }

  async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const data = JSON.stringify({ userId, expiresAt: expiresAt.toISOString() });

    try {
      if (redisClient.isOpen) {
        await redisClient.setEx(`session:${tokenHash}`, ttlSeconds, data);
        await redisClient.sAdd(`user_sessions:${userId}`, tokenHash);
        return;
      }
    } catch (err) {
      console.error('[REDIS AUTH REPOSITORY ERROR] Failed to save session to Redis:', err);
    }
  }

  async findRefreshToken(tokenHash: string) {
    try {
      if (redisClient.isOpen) {
        const cachedStr = await redisClient.get(`session:${tokenHash}`);
        if (cachedStr) {
          const { userId, expiresAt } = JSON.parse(cachedStr);
          const user = await this.findUserById(userId);
          if (!user) return null;
          return {
            userId,
            tokenHash,
            expiresAt: new Date(expiresAt),
            user,
          };
        }
      }
    } catch (err) {
      console.error('[REDIS AUTH REPOSITORY ERROR] Failed to fetch session from Redis:', err);
    }
    return null;
  }

  async deleteRefreshToken(tokenHash: string) {
    try {
      if (redisClient.isOpen) {
        const cachedStr = await redisClient.get(`session:${tokenHash}`);
        if (cachedStr) {
          const { userId } = JSON.parse(cachedStr);
          await redisClient.sRem(`user_sessions:${userId}`, tokenHash);
        }
        await redisClient.del(`session:${tokenHash}`);
      }
    } catch (err) {
      console.error('[REDIS AUTH REPOSITORY ERROR] Failed to delete session from Redis:', err);
    }
  }

  async deleteUserRefreshTokens(userId: string) {
    try {
      if (redisClient.isOpen) {
        const tokenHashes = await redisClient.sMembers(`user_sessions:${userId}`);
        for (const hash of tokenHashes) {
          await redisClient.del(`session:${hash}`);
        }
        await redisClient.del(`user_sessions:${userId}`);
      }
    } catch (err) {
      console.error('[REDIS AUTH REPOSITORY ERROR] Failed to delete user sessions from Redis:', err);
    }
  }

  async updateUser(userId: string, data: { name?: string; phoneNo?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data,
      include: {
        business: {
          include: {
            subscription: true,
          },
        },
        businessOwner: true,
      },
    });
  }

  async updatePassword(userId: string, passwordHash: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
