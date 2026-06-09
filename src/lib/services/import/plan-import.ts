import type { ImportPlan, OrgFileRow, OrderFileRow, PaymentFileRow, Quarantine } from './types';
import type { ImportScope as Scope } from './scope';

type Lookups = { orgIdByInn: Map<string, string>; partnerIdByInn: Map<string, string> };
type Rows = { orgs: OrgFileRow[]; orders: OrderFileRow[]; payments: PaymentFileRow[] };

const OUT_OF_SCOPE = 'вне вашей зоны видимости';
const NEEDS_LEADER = 'новая организация — требуется руководитель/админ';
const ORG_NOT_FOUND = 'организация не найдена (ИНН не сматчен)';

export function planImport(rows: Rows, lookups: Lookups, scope: Scope): ImportPlan {
  const counts = { orgsCreated: 0, orgsUpdated: 0, orgsStandalone: 0, ordersUpserted: 0, paymentsUpserted: 0 };
  const skipped = { orgs: [] as Quarantine[], orders: [] as Quarantine[], payments: [] as Quarantine[] };

  // Orgs that this import will make writable (existing-in-scope ∪ newly-created)
  const writableInn = new Set<string>();

  rows.orgs.forEach((o, i) => {
    const existingId = lookups.orgIdByInn.get(o.inn);
    const inScope = scope.unscoped || (existingId !== undefined && scope.allowedOrgIds.includes(existingId));
    if (!existingId && !scope.mayCreateOrgs) { skipped.orgs.push({ sheet: 'orgs', rowIndex: i, reason: NEEDS_LEADER }); return; }
    if (existingId && !inScope) { skipped.orgs.push({ sheet: 'orgs', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    if (existingId) counts.orgsUpdated++; else counts.orgsCreated++;
    if (!o.partnerInn || !lookups.partnerIdByInn.get(o.partnerInn)) counts.orgsStandalone++;
    writableInn.add(o.inn);
  });

  const orgWritable = (inn: string) => {
    if (writableInn.has(inn)) return true;
    const id = lookups.orgIdByInn.get(inn);
    return id !== undefined && (scope.unscoped || scope.allowedOrgIds.includes(id));
  };

  rows.orders.forEach((o, i) => {
    if (!lookups.orgIdByInn.get(o.orgInn) && !writableInn.has(o.orgInn)) { skipped.orders.push({ sheet: 'orders', rowIndex: i, reason: ORG_NOT_FOUND }); return; }
    if (!orgWritable(o.orgInn)) { skipped.orders.push({ sheet: 'orders', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    counts.ordersUpserted++;
  });

  rows.payments.forEach((p, i) => {
    if (!lookups.orgIdByInn.get(p.orgInn) && !writableInn.has(p.orgInn)) { skipped.payments.push({ sheet: 'payments', rowIndex: i, reason: ORG_NOT_FOUND }); return; }
    if (!orgWritable(p.orgInn)) { skipped.payments.push({ sheet: 'payments', rowIndex: i, reason: OUT_OF_SCOPE }); return; }
    counts.paymentsUpserted++;
  });

  return { counts, skipped, quarantine: [] };
}
