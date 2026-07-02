-- F2 (§16): supporting indexes for hot list queries.
--   Order  [companyId, executionStatus] / [companyId, financialStatus] —
--     C8 company-wide manager scope (`where { companyId, … }`: manager/orders
--     listOrders, leader/dashboard groupBy, manager dashboard KPIs). No index
--     led with companyId existed.
--   Notification [userId, createdAt] — feed `where userId orderBy createdAt desc`
--     (api/notifications GET); subsumes the old single-column [userId], dropped
--     below as a redundant leading-prefix duplicate.
--   Notification [userId, isRead] — unread badge count (manager/dashboard/kpis).
--   Organization [companyId] — C8 company-wide org scope (manager/organizations,
--     manager/finance). companyId had no index.
-- Audited as already covered (no change): Payment [orderId]/[organizationId]/
-- [paidAt] exist; Document [orderId,type]/[companyId]/[scanStatus] exist;
-- Order (managerId)/(organizationId)/(partnerId) are leading-prefixes of
-- existing composites.
-- Reversible: index-only, no data change (rollback = DROP/re-CREATE INDEX).

-- DropIndex
DROP INDEX "Notification_userId_idx";

-- CreateIndex
CREATE INDEX "Order_companyId_executionStatus_idx" ON "Order"("companyId", "executionStatus");

-- CreateIndex
CREATE INDEX "Order_companyId_financialStatus_idx" ON "Order"("companyId", "financialStatus");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Organization_companyId_idx" ON "Organization"("companyId");
