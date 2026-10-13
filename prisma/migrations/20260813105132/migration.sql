-- CreateIndex
CREATE INDEX "Order_outletId_status_deletedAt_idx" ON "Order"("outletId", "status", "deletedAt");
