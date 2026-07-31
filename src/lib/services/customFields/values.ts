import type { PrismaClient, CustomFieldType, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getActiveDefinitions } from './definitions';
import { resolveEntityAccess } from './access';
import { isCustomFieldEntity, type CustomFieldEntity } from './entities';
import { canRoleEdit, canRoleSee, sessionFieldRole } from './roles';
import { normalizeValue, validateFieldValue } from './coerce';

// ─── Error codes ────────────────────────────────────────────────────────────

export type ValuesError = 'forbidden' | 'not_found' | 'invalid_value' | 'invalid_entity_type';

type Result<T> = ({ ok: true } & T) | { ok: false; error: ValuesError };

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
    helpText: string | null;
    /** Может ли ТЕКУЩАЯ сессия править это поле (скоуп ∧ editableByRoles). */
    editable: boolean;
  };
  value: string | null;
};

/**
 * Активные определения сущности + значения конкретной записи (left join —
 * `value: null`, если ещё не заполнено). Отсортировано по sortOrder.
 *
 * `session` обязателен намеренно. Поле с ограниченной видимостью нельзя просто
 * спрятать в вёрстке — оно доедет до браузера в RSC-пропсах и утечёт. Поэтому
 * фильтрация по `visibleToRoles` делается здесь, на сервере, и забыть её нельзя:
 * без аргумента вызов не соберётся (в отличие от `teamMode`, §4 CLAUDE.md).
 *
 * Доступ к самой карточке проверяет вызывающий контекст (страница уже
 * отработала свой гард); здесь проверяется только ролевая видимость поля.
 */
export async function getValuesForEntity(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType: string,
  entityId: string
): Promise<Result<{ fields: FieldWithValue[] }>> {
  if (!isCustomFieldEntity(entityType)) {
    return { ok: false, error: 'invalid_entity_type' };
  }

  const role = sessionFieldRole(session);
  const definitions = (await getActiveDefinitions(prisma, entityType)).filter((d) =>
    canRoleSee(d.visibleToRoles, role)
  );

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
      helpText: def.helpText,
      editable: canRoleEdit(def.editableByRoles, role),
    },
    value: valueByDefId.get(def.id) ?? null,
  }));

  return { ok: true, fields };
}

/**
 * Удобная обёртка для страниц: сразу массив полей, без разбора Result.
 *
 * Ветка «сервис отказал» живёт здесь, а не в каждой карточке: иначе один и тот
 * же тернарник копируется по девяти страницам и в каждой требует своего теста.
 */
export async function getFieldsForEntity(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType: string,
  entityId: string
): Promise<FieldWithValue[]> {
  const res = await getValuesForEntity(prisma, session, entityType, entityId);
  return res.ok ? res.fields : [];
}

/**
 * Upsert значений настраиваемых полей записи.
 *
 * Право записи = доступ к карточке (`resolveEntityAccess`) ∧ роль сессии
 * ∈ `editableByRoles` поля. Первое отвечает «чья это карточка», второе —
 * «кому заказчик разрешил трогать это поле»; ни одно не заменяет другое.
 *
 * Валидация — до единой записи: любое некорректное значение отменяет всю
 * пачку (`invalid_value`), частичных сохранений не бывает.
 *
 * null/пустая строка = очистка поля. defId чужой сущности молча игнорируется.
 */
export async function setValues(
  prisma: PrismaClient,
  session: SessionPayload,
  entityType: string,
  entityId: string,
  values: Record<string, string | null>
): Promise<{ ok: true } | { ok: false; error: ValuesError }> {
  if (!isCustomFieldEntity(entityType)) {
    return { ok: false, error: 'invalid_entity_type' };
  }
  const entity: CustomFieldEntity = entityType;

  const role = sessionFieldRole(session);
  if (role === null) return { ok: false, error: 'forbidden' };

  // Скоуп карточки. Отсутствие записи и чужая запись неотличимы снаружи.
  const access = await resolveEntityAccess(prisma, session, entity, entityId);
  if (!access.canRead) return { ok: false, error: 'not_found' };

  const defIds = Object.keys(values);
  if (defIds.length === 0) return { ok: true };

  const definitions = await prisma.customFieldDefinition.findMany({
    where: { id: { in: defIds }, entityType: entity },
    select: { id: true, fieldType: true, options: true, editableByRoles: true, isActive: true },
  });

  const defMap = new Map(definitions.map((d) => [d.id, d]));

  // Пишем только то, что этой роли разрешено править. Поле вне права правки —
  // не «тихо пропускаем», а отказ: иначе форма отрапортует об успехе, а
  // значение не сохранится.
  for (const defId of defIds) {
    const def = defMap.get(defId);
    if (!def) continue; // чужая сущность — игнор (контракт до этапа 1)
    if (!def.isActive) continue; // деактивированное поле не пишем
    if (!canRoleEdit(def.editableByRoles, role)) {
      return { ok: false, error: 'forbidden' };
    }
  }

  // Валидируем ВСЁ до первой записи.
  const prepared: { defId: string; value: string | null }[] = [];
  for (const [defId, rawValue] of Object.entries(values)) {
    const def = defMap.get(defId);
    if (!def || !def.isActive) continue;

    if (rawValue === null || rawValue === '') {
      prepared.push({ defId, value: null });
      continue;
    }

    if (!validateFieldValue(def.fieldType, def.options, rawValue)) {
      return { ok: false, error: 'invalid_value' };
    }
    prepared.push({ defId, value: normalizeValue(def.fieldType, rawValue) });
  }

  if (prepared.length === 0) return { ok: true };

  await Promise.all(
    prepared.map(({ defId, value }) =>
      prisma.customFieldValue.upsert({
        where: { definitionId_entityId: { definitionId: defId, entityId } },
        create: { definitionId: defId, entityType: entity, entityId, value },
        update: { value },
      })
    )
  );

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'custom_field_values_set',
    entity: 'custom_field_value',
    entityId,
    after: { entityType: entity, defCount: prepared.length } as Prisma.JsonObject,
  });

  return { ok: true };
}
