import type { PrismaClient, CustomFieldType, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility, isLeaderSameCompany } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { getActiveDefinitions } from './definitions';

// ─── Error codes ────────────────────────────────────────────────────────────

export type ValuesError = 'forbidden' | 'not_found' | 'invalid_value';

type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; error: ValuesError };

// ─── Field-type validation ───────────────────────────────────────────────────

function validateFieldValue(fieldType: CustomFieldType, options: string[], value: string): boolean {
  switch (fieldType) {
    case 'text':
      return true; // any non-null string is valid
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n);
    }
    case 'date': {
      // Accept ISO date strings and any string parseable as a valid Date
      const d = new Date(value);
      return !isNaN(d.getTime());
    }
    case 'select':
      return options.includes(value);
    case 'boolean':
      return value === 'true' || value === 'false';
    default:
      return false;
  }
}

// ─── Order scope helper ──────────────────────────────────────────────────────

type OrderScopeRow = {
  id: string;
  managerId: string | null;
  organizationId: string | null;
  companyId: string | null;
};

/**
 * Checks whether the caller can write custom field values on the given order.
 * - admin: always allowed
 * - manager/leader: allowed iff the order is in their scope (reuses canSeeOrder + teamMode)
 * - organization, partner, others: forbidden
 *
 * Returns the order row (for entityId validation) or null if not found/denied.
 */
async function resolveWritableOrder(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<Result<{ order: OrderScopeRow }>> {
  // org/partner are read-only for values
  if (session.role === 'organization' || session.role === 'partner' || session.role === 'student') {
    return { ok: false, error: 'forbidden' };
  }

  if (session.role === 'admin') {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, managerId: true, organizationId: true, companyId: true },
    });
    if (!order) return { ok: false, error: 'not_found' };
    return { ok: true, order };
  }

  // manager (includes leader sub-role)
  if (session.role === 'manager') {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);

    // We need comments count for canSeeOrder's historical probe — fetch a comment count
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        managerId: true,
        organizationId: true,
        companyId: true,
        comments: { where: { authorId: session.sub }, take: 1, select: { id: true } },
      },
    });
    if (!order) return { ok: false, error: 'not_found' };

    const commentsCountByMe = order.comments.length;
    const leaderSameCompany = isLeaderSameCompany(session, order.companyId);

    if (!leaderSameCompany && !canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) {
      return { ok: false, error: 'not_found' };
    }

    const { comments: _probe, ...orderRow } = order;
    void _probe;
    return { ok: true, order: orderRow };
  }

  return { ok: false, error: 'forbidden' };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type FieldWithValue = {
  definition: {
    id: string;
    key: string;
    label: string;
    fieldType: CustomFieldType;
    options: string[];
    required: boolean;
    sortOrder: number;
  };
  value: string | null;
};

/**
 * Returns active definitions for the given entityType joined with that entity's
 * current values (left join — value is null if not yet set). Ordered by sortOrder.
 *
 * No session/role check here — the caller is responsible for ensuring it is
 * authorized to view the entity. This function is used from already-authorized
 * order-detail contexts (manager getOrder, admin order-detail, etc.).
 */
export async function getValuesForEntity(
  prisma: PrismaClient,
  entityType: string,
  entityId: string
): Promise<Result<{ fields: FieldWithValue[] }>> {
  const definitions = await getActiveDefinitions(prisma, entityType);

  if (definitions.length === 0) {
    return { ok: true, fields: [] };
  }

  const defIds = definitions.map((d) => d.id);
  const values = await prisma.customFieldValue.findMany({
    where: { definitionId: { in: defIds }, entityId },
    select: { definitionId: true, value: true },
  });

  const valueByDefId = new Map(values.map((v) => [v.definitionId, v.value]));

  const fields: FieldWithValue[] = definitions.map((def) => ({
    definition: {
      id: def.id,
      key: def.key,
      label: def.label,
      fieldType: def.fieldType,
      options: def.options,
      required: def.required,
      sortOrder: def.sortOrder,
    },
    value: valueByDefId.get(def.id) ?? null,
  }));

  return { ok: true, fields };
}

/**
 * Upserts custom field values for an entity.
 *
 * Permission rules:
 *   - admin: allowed for any entityId
 *   - manager/leader: allowed only if the order is in their scope (canSeeOrder + teamMode)
 *   - organization, partner, others: forbidden
 *
 * Validation: all values are validated before any write — if any single value
 * is invalid, returns invalid_value without writing anything.
 *
 * null/empty string values are stored as null (clearing the field).
 * defIds that don't belong to entityType are silently ignored.
 */
export async function setValues(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType: string,
  entityId: string,
  values: Record<string, string | null>
): Promise<{ ok: true } | { ok: false; error: ValuesError }> {
  // Resolve order scope (permission check)
  const scopeResult = await resolveWritableOrder(prisma, session, entityId);
  if (!scopeResult.ok) return scopeResult;

  // Filter defIds to those belonging to this entityType (ignore cross-entity writes)
  const defIds = Object.keys(values);
  if (defIds.length === 0) return { ok: true };

  const definitions = await prisma.customFieldDefinition.findMany({
    where: { id: { in: defIds }, entityType },
    select: { id: true, fieldType: true, options: true },
  });

  const defMap = new Map(definitions.map((d) => [d.id, d]));

  // Validate ALL values before writing any (reject if any one is invalid)
  for (const [defId, rawValue] of Object.entries(values)) {
    const def = defMap.get(defId);
    if (!def) continue; // not in entityType — will be ignored

    if (rawValue === null || rawValue === '') continue; // null/empty → store null, no validation needed

    if (!validateFieldValue(def.fieldType, def.options, rawValue)) {
      return { ok: false, error: 'invalid_value' };
    }
  }

  // Upsert each value (only for defIds in this entityType)
  const upsertOps: Promise<unknown>[] = [];
  for (const [defId, rawValue] of Object.entries(values)) {
    if (!defMap.has(defId)) continue; // not in entityType — skip

    const storedValue = rawValue === '' ? null : rawValue;

    upsertOps.push(
      prisma.customFieldValue.upsert({
        where: { definitionId_entityId: { definitionId: defId, entityId } },
        create: {
          definitionId: defId,
          entityType,
          entityId,
          value: storedValue,
        },
        update: { value: storedValue },
      })
    );
  }

  if (upsertOps.length > 0) {
    await Promise.all(upsertOps);
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'custom_field_values_set',
    entity: 'custom_field_value',
    entityId,
    after: { entityType, defCount: upsertOps.length } as Prisma.JsonObject,
  });

  return { ok: true };
}
