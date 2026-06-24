import type { PrismaClient, CustomFieldDefinition, CustomFieldType, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';

// ─── Error codes ────────────────────────────────────────────────────────────

export type DefinitionsError =
  | 'forbidden'
  | 'not_found'
  | 'invalid_key'
  | 'options_required'
  | 'duplicate_key';

type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; error: DefinitionsError };

// ─── Key validation ──────────────────────────────────────────────────────────

/** Machine key: starts with a-z, then a-z0-9_ only. */
const KEY_RE = /^[a-z][a-z0-9_]*$/;

function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

// ─── Admin gate ──────────────────────────────────────────────────────────────

function requireAdmin(session: SessionPayload): { ok: false; error: 'forbidden' } | null {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Admin view: lists definitions for a given entityType (or all if omitted).
 * Returns active AND inactive rows ordered by sortOrder asc.
 */
export async function listDefinitions(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType?: string
): Promise<Result<{ rows: CustomFieldDefinition[] }>> {
  const denied = requireAdmin(session);
  if (denied) return denied;

  const rows = await prisma.customFieldDefinition.findMany({
    where: entityType ? { entityType } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return { ok: true, rows };
}

/**
 * No session required — called from already-authorised order-detail contexts.
 * Returns only isActive=true definitions for the given entityType, ordered by sortOrder.
 */
export async function getActiveDefinitions(
  prisma: PrismaClient,
  entityType: string
): Promise<CustomFieldDefinition[]> {
  return prisma.customFieldDefinition.findMany({
    where: { entityType, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export type CreateDefinitionArgs = {
  entityType: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: string[];
  required?: boolean;
  sortOrder?: number;
};

export async function createDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateDefinitionArgs
): Promise<Result<{ definition: CustomFieldDefinition }>> {
  const denied = requireAdmin(session);
  if (denied) return denied;

  if (!isValidKey(args.key)) {
    return { ok: false, error: 'invalid_key' };
  }

  if (args.fieldType === 'select' && (!args.options || args.options.length === 0)) {
    return { ok: false, error: 'options_required' };
  }

  try {
    const definition = await prisma.customFieldDefinition.create({
      data: {
        entityType: args.entityType,
        key: args.key,
        label: args.label,
        fieldType: args.fieldType,
        options: args.options ?? [],
        required: args.required ?? false,
        sortOrder: args.sortOrder ?? 0,
      },
    });

    await recordAudit(prisma, {
      userId: session.sub,
      action: 'custom_field_definition_create',
      entity: 'custom_field_definition',
      entityId: definition.id,
      after: { entityType: definition.entityType, key: definition.key, fieldType: definition.fieldType },
    });

    return { ok: true, definition };
  } catch (err) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr?.code === 'P2002') {
      return { ok: false, error: 'duplicate_key' };
    }
    throw err;
  }
}

export type UpdateDefinitionPatch = {
  label?: string;
  options?: string[];
  required?: boolean;
  sortOrder?: number;
  isActive?: boolean;
};

export async function updateDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  patch: UpdateDefinitionPatch
): Promise<Result<{ definition: CustomFieldDefinition }>> {
  const denied = requireAdmin(session);
  if (denied) return denied;

  // Build only the mutable fields (key/entityType/fieldType are immutable after creation)
  const data: Prisma.CustomFieldDefinitionUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.options !== undefined) data.options = patch.options;
  if (patch.required !== undefined) data.required = patch.required;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  try {
    const definition = await prisma.customFieldDefinition.update({
      where: { id },
      data,
    });

    await recordAudit(prisma, {
      userId: session.sub,
      action: 'custom_field_definition_update',
      entity: 'custom_field_definition',
      entityId: definition.id,
      after: patch as Record<string, unknown>,
    });

    return { ok: true, definition };
  } catch (err) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr?.code === 'P2025') {
      return { ok: false, error: 'not_found' };
    }
    throw err;
  }
}

/**
 * Deactivates a definition (soft-delete). Never hard-deletes to preserve stored values.
 */
export async function deactivateDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<Result<{ definition: CustomFieldDefinition }>> {
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const definition = await prisma.customFieldDefinition.update({
      where: { id },
      data: { isActive: false },
    });

    await recordAudit(prisma, {
      userId: session.sub,
      action: 'custom_field_definition_deactivate',
      entity: 'custom_field_definition',
      entityId: definition.id,
    });

    return { ok: true, definition };
  } catch (err) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr?.code === 'P2025') {
      return { ok: false, error: 'not_found' };
    }
    throw err;
  }
}
