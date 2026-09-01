import type { DocumentStatus, DocumentType } from '@prisma/client';

/**
 * Этап 6 ТЗ (`У-148`) — жизненный цикл документа ОДНИМ объектом.
 *
 * Матрица отвечает на единственный вопрос: «можно ли перевести документ
 * этого типа из состояния A в состояние B». Держать её в одном месте важнее,
 * чем удобнее: разбросанные по сервисам `if`-ы разъезжаются, и документ
 * получает состояние, которого по бумаге быть не может (аннулированный
 * счёт «оплачивается», акт «истекает»).
 *
 * `draft`, `rejected` и `expired` — состояния коммерческого предложения
 * (`У-164`, этап 7). У счёта, акта, договора и ДС их нет: КП живёт по своим
 * правилам, и матрица это фиксирует, а не полагается на «никто так не
 * сделает».
 */

/** Типы, у которых есть жизненный цикл. Прочие (`other`, `report`…) — файлы. */
export const LIFECYCLE_TYPES = [
  'invoice',
  'act',
  'contract',
  'extra_agreement',
  // `У-164` (этап 7): у КП жизненный цикл СВОЙ — он единственный рождается
  // черновиком и единственный, кого клиент может отклонить. Список общий
  // потому, что от него зависит право уйти письмом и показ панели статуса;
  // сам набор переходов задаёт `PROPOSAL_FLOW` ниже.
  'commercial_proposal',
] as const satisfies readonly DocumentType[];

export type LifecycleType = (typeof LIFECYCLE_TYPES)[number];

export function isLifecycleType(type: DocumentType): type is LifecycleType {
  return (LIFECYCLE_TYPES as readonly DocumentType[]).includes(type);
}

/**
 * Разрешённые переходы. Пустой массив — конечное состояние.
 *
 * Общее правило для счёта, акта, договора и ДС: выпущен → отправлен →
 * принят; аннулировать можно с любого НЕконечного состояния (с причиной и
 * аудитом, `У-148`). Принять можно и сразу после выпуска: акт, подписанный
 * на бумаге, не обязан проходить через «отправлен».
 */
const ISSUED_FLOW: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['sent', 'accepted', 'cancelled'],
  sent: ['accepted', 'cancelled'],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

/**
 * Коммерческое предложение (`У-164`, этап 7). Отдельный поток, а не ещё одна
 * ссылка на `ISSUED_FLOW`, и вот почему:
 *
 * - КП **рождается черновиком** и уходит сразу в «отправлено». Состояния
 *   «выставлен» у него нет вовсе: выставить предложение и не отправить его
 *   бессмысленно — бумага существует ради отправки;
 * - отклонить и дать истечь можно ТОЛЬКО отправленное. Отклонённый черновик
 *   означал бы, что клиент отказался от того, чего не видел;
 * - `rejected` и `expired` — конечные. Передумавший клиент получает НОВОЕ
 *   предложение (перевыпуск `У-151`), а не воскрешение старого: у бумаги,
 *   которая уже у него на руках, срок в тексте напечатан.
 *
 * Из-за этих трёх различий общий поток пришлось бы обвешать оговорками
 * «кроме КП» в каждой строке — а разъезжаются именно оговорки.
 */
const PROPOSAL_FLOW: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ['sent', 'cancelled'],
  // `issued` у КП недостижим: попасть в него неоткуда, уйти — некуда.
  issued: [],
  sent: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

export const STATUS_TRANSITIONS: Record<LifecycleType, Record<DocumentStatus, DocumentStatus[]>> = {
  invoice: ISSUED_FLOW,
  act: ISSUED_FLOW,
  contract: ISSUED_FLOW,
  extra_agreement: ISSUED_FLOW,
  commercial_proposal: PROPOSAL_FLOW,
};

/** Статусы, из которых документ уже никуда не уйдёт. */
export function isFinalStatus(type: LifecycleType, status: DocumentStatus): boolean {
  return STATUS_TRANSITIONS[type][status].length === 0;
}

export function canTransition(
  type: LifecycleType,
  from: DocumentStatus,
  to: DocumentStatus
): boolean {
  return STATUS_TRANSITIONS[type][from].includes(to);
}

/**
 * Можно ли отправить документ клиенту письмом из его текущего состояния.
 *
 * Правило выводится из матрицы, а не хранится вторым списком: отправить можно
 * оттуда, откуда разрешён переход в «отправлен», плюс повторно — из
 * «отправлен» и «принят».
 *
 * Живёт здесь, а не в сервисе отправки, потому что нужно ОБОИМ: сервис решает,
 * пускать ли, экран — рисовать ли кнопку. Два списка литералов разъехались бы
 * при первой правке; так и вышло бы с КП (`У-164`), который отправляется из
 * ЧЕРНОВИКА, а не из «выставлен».
 *
 * Что даёт правило по типам: счёт, акт, договор и ДС — как раньше (`issued`,
 * `sent`, `accepted`); КП — из `draft`, `sent`, `accepted`, но НЕ из
 * `rejected` и `expired`: отправлять заново отклонённое или истёкшее
 * предложение нельзя, для этого есть перевыпуск.
 *
 * Строки на входе, а не узкие типы: экран получает документ уже разложенным
 * в вид для показа, где тип и статус — просто текст. Незнакомое значение —
 * `false`, то есть кнопки нет: ошибиться в сторону «не показали» безопаснее.
 */
export function canSendFromStatus(type: string, status: string): boolean {
  if (!isLifecycleType(type as DocumentType)) return false;
  const flow = STATUS_TRANSITIONS[type as LifecycleType][status as DocumentStatus];
  if (!flow) return false;
  return flow.includes('sent') || status === 'sent' || status === 'accepted';
}

/** Русские названия статусов — для списков и карточек (§15). */
export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Черновик',
  issued: 'Выставлен',
  sent: 'Отправлен',
  accepted: 'Принят',
  rejected: 'Отклонён',
  expired: 'Истёк срок',
  cancelled: 'Аннулирован',
};
