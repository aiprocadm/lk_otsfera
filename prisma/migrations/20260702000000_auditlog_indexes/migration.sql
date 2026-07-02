-- F1 (§16): AuditLog had zero indexes — every filtered/sorted read was a full
-- seq scan. Index set mirrors the actual query shapes:
--   [entity, entityId]  — per-entity trail (manager/orderDetail, admin statement audit)
--   [userId, createdAt] — actor filter + recency sort (admin/auditLog listAudit)
--   [createdAt]         — global recency feed (admin/dashboard recentEvents)
-- Reversible: index-only, no data change (rollback = DROP INDEX).

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
