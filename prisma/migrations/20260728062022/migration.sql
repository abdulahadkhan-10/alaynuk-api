-- AlterTable
ALTER TABLE "MenuItem" ALTER COLUMN "outletId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MenuItemOutlet" (
    "id" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "outletId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuItemOutlet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuItemOutlet_menuItemId_idx" ON "MenuItemOutlet"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemOutlet_outletId_idx" ON "MenuItemOutlet"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemOutlet_menuItemId_outletId_key" ON "MenuItemOutlet"("menuItemId", "outletId");

-- AddForeignKey
ALTER TABLE "MenuItemOutlet" ADD CONSTRAINT "MenuItemOutlet_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemOutlet" ADD CONSTRAINT "MenuItemOutlet_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
