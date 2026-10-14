import type { PrismaClient, EnrollmentRequest, EnrollmentStatus } from '@prisma/client';
import { attachStudentsToApprovedItems } from '@/lib/services/students/fromEnrollment';
import { recordAudit } from '@/lib/auth/audit';
import { linkCardsToStudentAccounts } from '@/lib/services/students/account';
import { notifySubmitterEnrollmentStatus } from './notify';

/**
 * Reviewer-side enrollment lifecycle (T5 → этап 2). Return the §3 Result
 * contract + audit; the route maps error codes to HTTP.
 *
 * Этап 2: заявка = шапка + позиции; approve/reject/markProvisioned работают по
 * шапке и зеркалируют статус во все не-отклонённые позиции. Переходы
 * `in_training`/`certificates_ready` — по позициям (bulk, PR-2), после них
 * статус шапки агрегируется как минимальный по конвейеру статус не-отклонённых
 * позиций. Provisioning остаётся РУЧНЫМ во внешней LMS: markProvisioned
 * фиксирует externalStudentId, полученный оператором (пишется в позицию,
 * когда она одна). Каждая смена статуса шапки шлёт подателю
 * `enrollment_status_changed` (best-effort, внутри notify.ts).
 */

/** Конвейер статусов (без rejected); индекс = порядок этапа. */
export const ENROLLMENT_PIPELINE: EnrollmentStatus[] = [
  'pending',
  'approved',
  'provisioned',
  'in_training',
  'certificates_ready',
];

/**
 * Статус шапки из статусов позиций (§2 спеки): минимальный по конвейеру среди
 * не-отклонённых; все позиции отклонены (или их нет) → rejected.
 */
export function aggregateEnrollmentHeaderStatus(
  items: { status: EnrollmentStatus }[]
): EnrollmentStatus {
  let min = ENROLLMENT_PIPELINE.length;
  for (const item of items) {
    if (item.status === 'rejected') continue;
    const idx = ENROLLMENT_PIPELINE.indexOf(item.status);
    if (idx < min) min = idx;
  }
  // min получен через indexOf по этому же массиву (enum не содержит статусов вне
  // конвейера, кроме отсеянного 'rejected'), поэтому здесь он всегда в диапазоне.
  return min === ENROLLMENT_PIPELINE.length ? 'rejected' : ENROLLMENT_PIPELINE[min]!;
}
async function loadRequest(prisma: PrismaClient, id: string) {
  return prisma.enrollmentRequest.findUnique({
    where: { id },
    // organizationId нужен У-29: одобрение заводит слушателей в организации заявки.
    select: { id: true, status: true, organizationId: true },
  });
}

export async function approveEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string }
): Promise<
  | { ok: true; request: EnrollmentRequest }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' }
> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'pending') return { ok: false, error: 'lifecycle_violation' };
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: { status: 'approved', reviewedByUserId: args.reviewerId, reviewedAt: new Date() },
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id, status: 'pending' },
      data: { status: 'approved' },
    });
    // У-29 (этап 5): каждая позиция без слушателя заводит запись в справочнике
    // и получает studentId. В ТОЙ ЖЕ транзакции — «одобрено, но людей нет» хуже,
    // чем неодобренная заявка (решение заказчика 09.08.2026).
    if (r.organizationId) {
      await attachStudentsToApprovedItems(tx, {
        requestId: r.id,
        organizationId: r.organizationId,
      });
    }
    return request;
  });
  // Этап 2 ТЗ 13.10.2026 (`У-273`, `Р-2-2`): карточки слушателей позиций
  // связываются с их учётками по e-mail — подтверждённое обучение появляется у
  // человека в кабинете (а в PR-3 — и уведомлением).
  const items = await prisma.enrollmentRequestItem.findMany({
    where: { requestId: r.id, status: 'approved', studentId: { not: null } },
    select: { studentId: true },
  });
  await linkCardsToStudentAccounts(
    prisma,
    // Позиции без карточки отсечены выборкой (`studentId: { not: null }`).
    items.map((i) => i.studentId as string)
  );
  await recordAudit(prisma, {
    userId: args.reviewerId,
    action: 'enrollment_approved',
    entity: 'enrollment_request',
    entityId: r.id,
    after: { status: 'approved' },
  });
  await notifySubmitterEnrollmentStatus(prisma, updated);
  return { ok: true, request: updated };
}

export async function rejectEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; reason: string }
): Promise<
  | { ok: true; request: EnrollmentRequest }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' }
> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'provisioned' || r.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: {
        status: 'rejected',
        rejectedReason: args.reason.trim() || 'Отклонено',
        reviewedByUserId: args.reviewerId,
        reviewedAt: new Date(),
      },
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id },
      data: { status: 'rejected' },
    });
    return request;
  });
  await recordAudit(prisma, {
    userId: args.reviewerId,
    action: 'enrollment_rejected',
    entity: 'enrollment_request',
    entityId: r.id,
    after: { reason: updated.rejectedReason },
  });
  await notifySubmitterEnrollmentStatus(prisma, updated);
  return { ok: true, request: updated };
}

export async function markProvisioned(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; externalStudentId?: string }
): Promise<
  | { ok: true; request: EnrollmentRequest }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' | 'validation' }
> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'approved') return { ok: false, error: 'lifecycle_violation' };
  const sid = args.externalStudentId?.trim() || null;

  const itemCount = await prisma.enrollmentRequestItem.count({ where: { requestId: r.id } });
  // Одиночная заявка (включая все legacy): id из LMS обязателен, как раньше.
  // Для многопозиционной один общий id не имеет смысла — принимаем без него
  // (индивидуальные id по позициям — PR-2).
  if (itemCount <= 1 && !sid) return { ok: false, error: 'validation' };

  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: { status: 'provisioned', provisionedAt: new Date() },
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id, status: { not: 'rejected' } },
      data: {
        status: 'provisioned',
        ...(itemCount === 1 && sid ? { externalStudentId: sid } : {}),
      },
    });
    return request;
  });
  await recordAudit(prisma, {
    userId: args.reviewerId,
    action: 'enrollment_provisioned',
    entity: 'enrollment_request',
    entityId: r.id,
    after: { externalStudentId: sid },
  });
  await notifySubmitterEnrollmentStatus(prisma, updated);
  return { ok: true, request: updated };
}

/**
 * Bulk-переход позиций `provisioned → in_training → certificates_ready`
 * (решение §10-4: вручную менеджером из очереди). `itemIds` — выбранные
 * позиции; без них — все позиции на предыдущем шаге конвейера. Каждая
 * выбранная позиция обязана стоять ровно на предыдущем шаге, иначе
 * `lifecycle_violation`. После перехода шапка агрегируется; смена статуса
 * шапки уведомляет подателя.
 */
export async function advanceEnrollmentItems(
  prisma: PrismaClient,
  args: {
    id: string;
    reviewerId: string;
    target: 'in_training' | 'certificates_ready';
    itemIds?: string[];
  }
): Promise<
  | { ok: true; request: EnrollmentRequest; movedCount: number; headerChanged: boolean }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' | 'validation' }
> {
  const r = await prisma.enrollmentRequest.findUnique({
    where: { id: args.id },
    select: { id: true, status: true, items: { select: { id: true, status: true } } },
  });
  if (!r) return { ok: false, error: 'not_found' };

  const prev: EnrollmentStatus = args.target === 'in_training' ? 'provisioned' : 'in_training';
  const requested = args.itemIds
    ? Array.from(new Set(args.itemIds.map((s) => s.trim()).filter(Boolean)))
    : null;

  let targetIds: string[];
  if (requested) {
    if (!requested.length) return { ok: false, error: 'validation' };
    const byId = new Map(r.items.map((i) => [i.id, i]));
    if (requested.some((id) => !byId.has(id))) return { ok: false, error: 'validation' };
    if (requested.some((id) => byId.get(id)!.status !== prev))
      return { ok: false, error: 'lifecycle_violation' };
    targetIds = requested;
  } else {
    targetIds = r.items.filter((i) => i.status === prev).map((i) => i.id);
    if (!targetIds.length) return { ok: false, error: 'lifecycle_violation' };
  }

  const moved = new Set(targetIds);
  const nextItems = r.items.map((i) => (moved.has(i.id) ? { status: args.target } : i));
  const headerStatus = aggregateEnrollmentHeaderStatus(nextItems);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id, id: { in: targetIds } },
      data: { status: args.target },
    });
    return tx.enrollmentRequest.update({
      where: { id: r.id },
      // update и при неизменном статусе — вернуть свежую шапку одним запросом.
      data: { status: headerStatus },
    });
  });

  const headerChanged = headerStatus !== r.status;
  await recordAudit(prisma, {
    userId: args.reviewerId,
    action: 'enrollment_items_advanced',
    entity: 'enrollment_request',
    entityId: r.id,
    after: { target: args.target, movedCount: targetIds.length, headerStatus },
  });
  if (headerChanged) await notifySubmitterEnrollmentStatus(prisma, updated);
  return { ok: true, request: updated, movedCount: targetIds.length, headerChanged };
}

/** `YYYY-MM-DD` → полночь UTC (`@db.Date`); пустое — null; кривое — undefined. */
function parseDay(value: string | null): Date | null | undefined {
  if (value === null || value.trim() === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value.trim() ? undefined : d;
}

/**
 * Сроки обучения по позиции заявки (`У-284`, `Р-2-3`, этап 2 ТЗ 13.10.2026):
 * сотрудник задаёт дату начала и окончания — слушатель видит их в «Мой
 * профиль», а за три дня до окончания получает напоминание (`У-286`).
 * Даты необязательные; окончание раньше начала — `validation`.
 */
export async function setEnrollmentItemDates(
  prisma: PrismaClient,
  args: {
    id: string;
    itemId: string;
    reviewerId: string;
    startsOn: string | null;
    endsOn: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'validation' }> {
  const startsOn = parseDay(args.startsOn);
  const endsOn = parseDay(args.endsOn);
  if (startsOn === undefined || endsOn === undefined) return { ok: false, error: 'validation' };
  if (startsOn && endsOn && endsOn < startsOn) return { ok: false, error: 'validation' };
  const item = await prisma.enrollmentRequestItem.findFirst({
    where: { id: args.itemId, requestId: args.id },
    select: { id: true, startsOn: true, endsOn: true },
  });
  if (!item) return { ok: false, error: 'not_found' };
  await prisma.enrollmentRequestItem.update({
    where: { id: item.id },
    data: { startsOn, endsOn },
  });
  await recordAudit(prisma, {
    userId: args.reviewerId,
    action: 'enrollment_item_dates_set',
    entity: 'enrollment_request',
    entityId: args.id,
    before: {
      itemId: item.id,
      startsOn: item.startsOn?.toISOString().slice(0, 10) ?? null,
      endsOn: item.endsOn?.toISOString().slice(0, 10) ?? null,
    },
    after: {
      itemId: item.id,
      startsOn: startsOn?.toISOString().slice(0, 10) ?? null,
      endsOn: endsOn?.toISOString().slice(0, 10) ?? null,
    },
  });
  return { ok: true };
}
