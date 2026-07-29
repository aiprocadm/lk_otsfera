'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { setValues } from '@/lib/services/customFields';
import type { ValuesError, CustomFieldEntity } from '@/lib/services/customFields';

type ActionResult = { ok: true } | { ok: false; error: ValuesError };

/**
 * Пути, которые надо освежить после записи значений: одна и та же карточка
 * живёт в нескольких кабинетах, и без revalidate соседний кабинет продолжит
 * показывать старое значение из кэша.
 */
const REVALIDATE_PATHS: Record<CustomFieldEntity, (id: string) => string[]> = {
  order: (id) => [`/manager/orders/${id}`, `/leader/orders/${id}`, `/admin/orders/${id}`],
  organization: (id) => [`/admin/organizations/${id}`, `/manager/organizations/${id}`],
  partner: (id) => [`/admin/partners/${id}`],
  student: (id) => [`/manager/students/${id}`, `/organization/students/${id}`],
  document: (id) => [`/admin/documents/${id}`]
};

/**
 * Server action: сохранение значений настраиваемых полей любой из пяти
 * сущностей §11.
 *
 * Права проверяет сервис `setValues`: доступ к карточке ∧ роль из
 * `editableByRoles` конкретного поля. Экшен ничего не решает сам — иначе
 * появился бы второй источник правды о правах.
 */
export async function saveCustomFieldsAction(
  entityType: CustomFieldEntity,
  entityId: string,
  values: Record<string, string | null>
): Promise<ActionResult> {
  const session = await requireSession();
  const result = await setValues(prisma, session, entityType, entityId, values);
  if (!result.ok) return result;

  for (const path of REVALIDATE_PATHS[entityType](entityId)) {
    revalidatePath(path);
  }
  return { ok: true };
}

/**
 * Совместимость: узкая обёртка для заказа. Оставлена, чтобы не переписывать
 * вызовы на деталке заказа (и их регрессы) в этом PR.
 */
export async function saveOrderCustomFieldsAction(
  orderId: string,
  values: Record<string, string | null>
): Promise<ActionResult> {
  return saveCustomFieldsAction('order', orderId, values);
}
