'use server';

import { revalidatePath } from 'next/cache';
import type { CatalogUnit } from '@prisma/client';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { CATALOG_UNIT_LABELS } from '@/lib/services/admin/catalogItems';
import {
  addOrderLine,
  buildLinesFromItems,
  recalcOrderTotal,
  removeOrderLine,
  setOrderTotalManually,
  updateOrderLine,
  type OrderLineInput,
} from '@/lib/services/orders/orderLines';

/**
 * Этап 5 (`У-139`, `У-140`) — server-actions блока «Состав и стоимость».
 * Тонкие адаптеры §3: разбор формы + ревалидация, ни одного решения о правах.
 *
 * Гард — `requireSession()`: роль (admin ∨ контур сотрудников ЦО), скоуп
 * заказа (`canSeeOrder` с `teamMode`) и запрет правки заказов из 1С энфорсит
 * сервис. Права раздела (`requireSettingsSection`) здесь ни при чём: это
 * карточка заказа, а не хаб настроек — там гард другой и по другому поводу.
 */

export type OrderLineActionResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'validation' | 'order_from_1c';
      messages?: string[];
    };

type BuildLinesActionResult =
  | { ok: true; created: number; withoutPrice: string[] }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'validation' | 'order_from_1c';
      messages?: string[];
    };

/**
 * Одна и та же карточка заказа открыта в трёх кабинетах — освежаем все три,
 * иначе соседний покажет из кэша старые строки и старую сумму.
 */
function revalidate(orderId: string) {
  for (const path of [
    `/admin/orders/${orderId}`,
    `/leader/orders/${orderId}`,
    `/manager/orders/${orderId}`,
  ]) {
    revalidatePath(path);
  }
}

function inputFrom(fd: FormData): OrderLineInput {
  const unitRaw = str(fd, 'unit');
  const unit = (
    Object.keys(CATALOG_UNIT_LABELS).includes(unitRaw) ? unitRaw : 'person'
  ) as CatalogUnit;
  const vatRaw = str(fd, 'vatRate');
  const discountRaw = str(fd, 'discountPercent').trim();
  return {
    // Пустая строка = свободная строка без связи с каталогом (цена — снимок,
    // связь нужна только чтобы понимать, откуда пришла позиция).
    catalogItemId: str(fd, 'catalogItemId') || null,
    title: str(fd, 'title'),
    quantity: str(fd, 'quantity'),
    unit,
    unitPrice: str(fd, 'unitPrice'),
    discountPercent: discountRaw === '' ? null : discountRaw,
    // 'none' из селекта = «не облагается» (УСН) → null.
    vatRate: vatRaw === 'none' || vatRaw === '' ? null : vatRaw,
    vatIncluded: str(fd, 'vatIncluded') === 'on',
    sortOrder: Number(str(fd, 'sortOrder') || '0'),
  };
}

export async function addOrderLineAction(
  orderId: string,
  fd: FormData
): Promise<OrderLineActionResult> {
  const session = await requireSession();
  const res = await addOrderLine(prisma, session, orderId, inputFrom(fd));
  if (!res.ok) return res;
  revalidate(orderId);
  return { ok: true };
}

/**
 * Правка строки. `orderId` идёт скрытым полем формы: сервис отвечает только
 * `{ ok: true }`, а ревалидировать нужно конкретную карточку — без номера
 * заказа освежать было бы нечего. Подмена поля ничего не открывает: она может
 * лишь сбросить кэш чужой страницы.
 */
export async function updateOrderLineAction(
  lineId: string,
  fd: FormData
): Promise<OrderLineActionResult> {
  const session = await requireSession();
  const orderId = str(fd, 'orderId');
  if (!orderId) {
    return { ok: false, error: 'validation', messages: ['Нет идентификатора заказа'] };
  }
  const res = await updateOrderLine(prisma, session, lineId, inputFrom(fd));
  if (!res.ok) return res;
  revalidate(orderId);
  return { ok: true };
}

/** Удаление строки. `orderId` — вторым аргументом, по той же причине. */
export async function removeOrderLineAction(
  lineId: string,
  orderId: string
): Promise<OrderLineActionResult> {
  const session = await requireSession();
  const res = await removeOrderLine(prisma, session, lineId);
  if (!res.ok) return res;
  revalidate(orderId);
  return { ok: true };
}

export async function setOrderTotalManuallyAction(
  orderId: string,
  fd: FormData
): Promise<OrderLineActionResult> {
  const session = await requireSession();
  const res = await setOrderTotalManually(prisma, session, orderId, str(fd, 'totalAmount'));
  if (!res.ok) return res;
  revalidate(orderId);
  return { ok: true };
}

export async function recalcOrderTotalAction(orderId: string): Promise<OrderLineActionResult> {
  const session = await requireSession();
  const res = await recalcOrderTotal(prisma, session, orderId);
  if (!res.ok) return res;
  revalidate(orderId);
  return { ok: true };
}

export async function buildLinesFromItemsAction(
  orderId: string
): Promise<BuildLinesActionResult> {
  const session = await requireSession();
  const res = await buildLinesFromItems(prisma, session, orderId);
  if (!res.ok) return res;
  revalidate(orderId);
  // `withoutPrice` доносим до экрана: направления без цены в каталоге дали
  // строку с нулём, и молчать об этом нельзя (§15).
  return { ok: true, created: res.created, withoutPrice: res.withoutPrice };
}
