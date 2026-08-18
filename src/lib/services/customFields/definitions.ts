import type { PrismaClient, CustomFieldDefinition, CustomFieldType, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { isCustomFieldEntity, type CustomFieldEntity } from './entities';
import { isReservedKey } from './systemFields';
import { sanitizeRoles } from './roles';
import { requiresOptions } from './coerce';

// ─── Error codes ────────────────────────────────────────────────────────────

type DefinitionsError =
  | 'forbidden'
  | 'not_found'
  | 'invalid_key'
  | 'options_required'
  | 'duplicate_key'
  | 'invalid_entity_type'
  | 'reserved_key';

type Result<T> = ({ ok: true } & T) | { ok: false; error: DefinitionsError };

// ─── Key validation ──────────────────────────────────────────────────────────

/** Machine key: starts with a-z, then a-z0-9_ only. */
const KEY_RE = /^[a-z][a-z0-9_]*$/;

function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

// ─── Config gate ─────────────────────────────────────────────────────────────

/**
 * §4 ТЗ v0.5: «Настройка полей и статусов» — администратор И руководитель.
 * Руководитель — самостоятельная роль `leader` (ТЗ 2026-08-17),
 * поэтому проверяется не top-level Role, а `isManagerLeader`.
 * Обычный менеджер — forbidden.
 */
function requireFieldsAdmin(session: SessionPayload): { ok: false; error: 'forbidden' } | null {
  if (session.role === 'admin') return null;
  if (isManagerLeader(session)) return null;
  return { ok: false, error: 'forbidden' };
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
  const denied = requireFieldsAdmin(session);
  if (denied) return denied;

  const rows = await prisma.customFieldDefinition.findMany({
    where: entityType ? { entityType } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return { ok: true, rows };
}

/**
 * No session required — called from already-authorised entity-detail contexts.
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
  /** §11: подсказка под полем. */
  helpText?: string | null;
  /** §11: роли, которые видят поле. Пусто = видят все, кому доступна карточка. */
  visibleToRoles?: string[];
  /** §11: роли, которые правят поле. Пусто = admin + leader (решение Q1). */
  editableByRoles?: string[];
};

export async function createDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateDefinitionArgs
): Promise<Result<{ definition: CustomFieldDefinition }>> {
  const denied = requireFieldsAdmin(session);
  if (denied) return denied;

  if (!isCustomFieldEntity(args.entityType)) {
    return { ok: false, error: 'invalid_entity_type' };
  }
  const entityType: CustomFieldEntity = args.entityType;

  if (!isValidKey(args.key)) {
    return { ok: false, error: 'invalid_key' };
  }

  // §11: системное поле нельзя ни удалить, ни продублировать настраиваемым —
  // иначе в карточке организации будет два «Статуса» из разных источников.
  if (isReservedKey(entityType, args.key)) {
    return { ok: false, error: 'reserved_key' };
  }

  if (requiresOptions(args.fieldType) && (!args.options || args.options.length === 0)) {
    return { ok: false, error: 'options_required' };
  }

  try {
    const definition = await prisma.customFieldDefinition.create({
      data: {
        entityType,
        key: args.key,
        label: args.label,
        fieldType: args.fieldType,
        options: args.options ?? [],
        required: args.required ?? false,
        sortOrder: args.sortOrder ?? 0,
        helpText: args.helpText ?? null,
        visibleToRoles: sanitizeRoles(args.visibleToRoles),
        editableByRoles: sanitizeRoles(args.editableByRoles),
      },
    });

    await recordAudit(prisma, {
      userId: session.sub,
      action: 'custom_field_definition_create',
      entity: 'custom_field_definition',
      entityId: definition.id,
      after: {
        entityType: definition.entityType,
        key: definition.key,
        fieldType: definition.fieldType,
      },
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
  helpText?: string | null;
  visibleToRoles?: string[];
  editableByRoles?: string[];
};

export async function updateDefinition(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  patch: UpdateDefinitionPatch
): Promise<Result<{ definition: CustomFieldDefinition }>> {
  const denied = requireFieldsAdmin(session);
  if (denied) return denied;

  // Build only the mutable fields (key/entityType/fieldType are immutable after creation)
  const data: Prisma.CustomFieldDefinitionUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.options !== undefined) data.options = patch.options;
  if (patch.required !== undefined) data.required = patch.required;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  if (patch.helpText !== undefined) data.helpText = patch.helpText;
  if (patch.visibleToRoles !== undefined) data.visibleToRoles = sanitizeRoles(patch.visibleToRoles);
  if (patch.editableByRoles !== undefined)
    data.editableByRoles = sanitizeRoles(patch.editableByRoles);

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
  const denied = requireFieldsAdmin(session);
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
