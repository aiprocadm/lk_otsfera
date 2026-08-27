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

export const STATUS_TRANSITIONS: Record<LifecycleType, Record<DocumentStatus, DocumentStatus[]>> = {
  invoice: ISSUED_FLOW,
  act: ISSUED_FLOW,
  contract: ISSUED_FLOW,
  extra_agreement: ISSUED_FLOW,
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
