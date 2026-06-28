-- C-01: guarantee at most ONE live (non-superseded) commission statement per
-- (partner, period), even under a race between two writers (e.g. the monthly
-- cron and a manual recalc). A FULL unique index would break the supersede
-- lifecycle, where a period legitimately keeps historical superseded rows
-- alongside the current one; a PARTIAL unique index over only the still-active
-- rows (supersededBy IS NULL) gives the invariant while allowing that history.
--
-- Prisma cannot express a partial/filtered index in schema.prisma (same as the
-- Document_order_xor_company CHECK constraint), so it is defined here as raw SQL.
--
-- PRE-DEPLOY REQUIREMENT: if production already holds duplicate live rows for any
-- (partnerId, periodFrom, periodTo), this index will FAIL to build. Run the
-- dedupe pass first: `tsx scripts/dedupe-commission-statements.ts` (keeps the
-- latest by calculatedAt, supersedes the rest). See the T4 close-out.
CREATE UNIQUE INDEX "CommissionStatement_partner_period_active_key"
  ON "CommissionStatement" ("partnerId", "periodFrom", "periodTo")
  WHERE "supersededBy" IS NULL;
