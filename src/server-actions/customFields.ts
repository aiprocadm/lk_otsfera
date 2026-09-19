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
 *
 * **Адреса — настоящие, а не шлюзы.** Карточка сотрудника переехала внутрь
 * организации (`У-97`, `У-100`): `/manager/students/<id>` и
 * `/organization/students/<id>` теперь только уводят на новое место. Освежать
 * шлюз бессмысленно: за ним нет экрана, который показывал бы поле. Сегодня это
 * ничего не ломало — все карточки объявлены `force-dynamic` и из кэша не
 * отдаются, — но в день, когда шлюз удалят по сроку (`У-263`), здесь остался бы
 * адрес в никуда. Держит страж `navigation.no-gateway-links`.
 *
 * Адрес кабинета сотрудников ЦО — шаблон маршрута: номер организации здесь
 * неизвестен, а `revalidatePath` со вторым аргументом `'page'` освежает все
 * экземпляры маршрута сразу.
 */
type RevalidateTarget = { path: string; routePattern?: true };

const REVALIDATE_PATHS: Record<CustomFieldEntity, (id: string) => RevalidateTarget[]> = {
  order: (id) => [
    { path: `/manager/orders/${id}` },
    { path: `/leader/orders/${id}` },
    { path: `/admin/orders/${id}` },
  ],
  organization: (id) => [
    { path: `/admin/organizations/${id}` },
    { path: `/manager/organizations/${id}` },
  ],
  partner: (id) => [{ path: `/admin/partners/${id}` }],
  student: (id) => [
    { path: `/organization/company/students/${id}` },
    { path: '/manager/organizations/[id]/students/[studentId]', routePattern: true },
    { path: '/leader/organizations/[id]/students/[studentId]', routePattern: true },
    { path: '/admin/organizations/[id]/students/[studentId]', routePattern: true },
    { path: '/partner/portfolio/[orgId]/students/[studentId]', routePattern: true },
  ],
  document: (id) => [{ path: `/admin/documents/${id}` }],
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

  for (const target of REVALIDATE_PATHS[entityType](entityId)) {
    if (target.routePattern) revalidatePath(target.path, 'page');
    else revalidatePath(target.path);
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
