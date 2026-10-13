import { prisma } from '../../config/prisma';
import { NO_MATCH_UUID, isAllOutlets, menuItemScope, outletScope } from '../../utils/tenantScope';

export class MenuRepository {
  async createCategory(outletId: string, data: any) {
    return prisma.menuCategory.create({
      data: {
        ...data,
        outletId,
      },
    });
  }

  async createMenuItem(outletId: string, data: any) {
    const { outletIds, ...itemData } = data;
    const targetOutletIds: string[] = Array.isArray(outletIds) && outletIds.length > 0
      ? outletIds
      : (outletId && outletId !== 'all' ? [outletId] : []);

    const primaryOutletId = targetOutletIds[0] || (outletId !== 'all' ? outletId : null);

    const createData: any = {
      ...itemData,
      outletId: primaryOutletId,
    };

    if (targetOutletIds.length > 0) {
      createData.outlets = {
        createMany: {
          data: targetOutletIds.map((outId: string) => ({
            outletId: outId,
          })),
          skipDuplicates: true,
        },
      };
    }

    return (prisma as any).menuItem.create({
      data: createData,
    });
  }

  async getCategories(outletId: string, businessId?: string) {
    const where: any = { deletedAt: null };
    if (outletId && outletId !== "all") {
      where.outletId = outletId;
    } else if (businessId) {
      where.outlet = { businessId };
    }

    return prisma.menuCategory.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        menuItems: {
          where: { deletedAt: null },
          include: {
            outlet: { select: { id: true, name: true } },
            outlets: { select: { outletId: true, isActive: true } },
          },
        },
      },
    });
  }

  async getMenuItems(outletId: string, categoryId?: string, search?: string, businessId?: string, isAvailable?: string, isVeg?: string, dietaryType?: string) {
    const where: any = { deletedAt: null };
    if (outletId && outletId !== "all") {
      where.OR = [
        { outletId },
        { outlets: { some: { outletId } } },
      ];
    } else if (businessId) {
      where.OR = [
        { outlet: { businessId } },
        { outlets: { some: { outlet: { businessId } } } },
      ];
    }

    if (categoryId && categoryId !== "ALL") {
      where.categoryId = categoryId;
    }
    if (search) {
      const searchCond = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
      if (where.OR) {
        where.AND = [{ OR: searchCond }];
      } else {
        where.OR = searchCond;
      }
    }
    if (isAvailable !== undefined && isAvailable !== null && isAvailable !== "") {
      const isAvailBool = isAvailable === "true" || isAvailable === "1";
      if (outletId && outletId !== "all") {
        where.outlets = {
          some: {
            outletId,
            isActive: isAvailBool,
          }
        };
      } else {
        where.isActive = isAvailBool;
      }
    }
    if (dietaryType && ["VEG", "NON_VEG", "VEGAN"].includes(dietaryType.toUpperCase())) {
      where.dietaryType = dietaryType.toUpperCase();
    } else if (isVeg !== undefined && isVeg !== null && isVeg !== "") {
      const vegBool = isVeg === "true" || isVeg === "1";
      if (vegBool) {
        where.dietaryType = { in: ["VEG", "VEGAN"] };
      } else {
        where.dietaryType = "NON_VEG";
      }
    }

    return (prisma as any).menuItem.findMany({
      where,
      include: {
        category: true,
        outlets: { select: { outletId: true, isActive: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateMenuItem(outletId: string, id: string, data: any) {
    const { outletIds, ...updateData } = data;

    return (prisma as any).$transaction(async (tx: any) => {
      // Handle status toggle (isActive / availability)
      if (updateData.isActive !== undefined) {
        const itemIsActive = updateData.isActive;
        delete updateData.isActive;

        if (outletId && outletId !== "all") {
          await tx.menuItemOutlet.updateMany({
            where: { menuItemId: id, outletId },
            data: { isActive: itemIsActive },
          });
        } else {
          await tx.menuItem.updateMany({
            where: { id, deletedAt: null },
            data: { isActive: itemIsActive },
          });
          await tx.menuItemOutlet.updateMany({
            where: { menuItemId: id },
            data: { isActive: itemIsActive },
          });
        }
      }

      if (Object.keys(updateData).length > 0) {
        await tx.menuItem.updateMany({
          where: { id, deletedAt: null },
          data: updateData,
        });
      }

      if (Array.isArray(outletIds)) {
        if (outletIds.length === 0) {
          // Soft delete the item if it's no longer assigned to any outlets
          await tx.menuItem.updateMany({
            where: { id, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        } else {
          // Sync MenuItemOutlet records
          await tx.menuItemOutlet.deleteMany({
            where: {
              menuItemId: id,
              outletId: { notIn: outletIds },
            },
          });

          await tx.menuItemOutlet.createMany({
            data: outletIds.map((outId: string) => ({
              menuItemId: id,
              outletId: outId,
            })),
            skipDuplicates: true,
          });

          await tx.menuItem.update({
            where: { id },
            data: { outletId: outletIds[0] },
          });
        }
      }
    }, { maxWait: 10000, timeout: 20000 });
  }

  async findCategoryById(outletId: string, id: string, businessId?: string | null) {
    // Selected outlet's category, or in "all outlets" mode one of the caller's business
    return prisma.menuCategory.findFirst({
      where: { id, deletedAt: null, ...outletScope(outletId, businessId) },
    });
  }

  async findMenuItemById(outletId: string, id: string, businessId?: string | null) {
    // Only items sold at the selected outlet, or in "all outlets" mode at any of the caller's outlets
    return (prisma as any).menuItem.findFirst({
      where: { id, deletedAt: null, ...menuItemScope(outletId, businessId) },
      include: {
        category: true,
        outlets: { select: { outletId: true, isActive: true } },
      },
    });
  }

  async deleteMenuItem(outletId: string, id: string) {
    // Perform soft delete
    return prisma.menuItem.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async updateCategory(id: string, data: any) {
    return prisma.menuCategory.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id: string) {
    return prisma.$transaction([
      prisma.menuCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      prisma.menuItem.updateMany({
        where: { categoryId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    ]);
  }

  async findPublicMenu(outletId: string, businessId?: string | null) {
    // Items available at this outlet (or, in "all outlets" mode, at any of the caller's outlets)
    const availableHere = isAllOutlets(outletId)
      ? { outlet: { businessId: businessId || NO_MATCH_UUID }, isActive: true }
      : { outletId, isActive: true };
    const itemWhere = {
      isActive: true,
      deletedAt: null,
      outlets: { some: availableHere },
    };
    return (prisma as any).menuCategory.findMany({
      // Only categories that actually contain such items — never other businesses' categories
      where: { isActive: true, deletedAt: null, menuItems: { some: itemWhere } },
      include: {
        menuItems: {
          where: itemWhere,
          include: {
            outlets: { select: { outletId: true, isActive: true } },
          },
        },
      },
    });
  }
}
export default MenuRepository;


