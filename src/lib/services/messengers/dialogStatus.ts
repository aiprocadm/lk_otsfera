/**
 * Статус диалога и его автомат (`У-207`, спека этапа 3 §3.2).
 *
 * До этапа 3 статусов было два — `open`/`closed`, и менялись они только руками.
 * Понять «кто кого ждёт» было нельзя, поэтому просрочку ответа никто не считал.
 *
 * Модуль ЧИСТЫЙ (без Prisma, без сессии) и **единственный** источник значений:
 * страж `messengers.dialog-status-machine` запрещает литералы статусов в других
 * файлах. Переходы считаются в трёх местах, и все три зовут этот модуль:
 * `appendInbound.ts` (пришло от клиента), `recordOutbound.ts` (ответил
 * сотрудник) и `status.ts` (закрыли или открыли руками).
 */

export const DIALOG_STATUSES = ['open', 'waiting_staff', 'waiting_client', 'closed'] as const;

export type DialogStatus = (typeof DIALOG_STATUSES)[number];

/**
 * Именованные значения для запросов к базе. В `where`/`data` Prisma статус —
 * обычная строка, и опечатка там не ловится типами: запрос просто ничего не
 * найдёт, молча. Поэтому в сервисах и воркере статус берётся отсюда, а страж
 * `messengers.dialog-status-machine` следит, чтобы литералов `waiting_*` вне
 * этого модуля не было.
 */
export const DIALOG_STATUS = {
  open: 'open',
  waitingStaff: 'waiting_staff',
  waitingClient: 'waiting_client',
  closed: 'closed',
} as const satisfies Record<string, DialogStatus>;

/** Как статус называется на экране — одно имя во всех кабинетах (§0.2 ТЗ). */
export const DIALOG_STATUS_LABELS: Record<DialogStatus, string> = {
  open: 'Новый',
  waiting_staff: 'Ждёт ответа',
  waiting_client: 'Ждём клиента',
  closed: 'Закрыт',
};

/** Статусы, которые сотрудник может выставить руками (кнопки карточки). */
export const MANUAL_DIALOG_STATUSES = ['open', 'closed'] as const satisfies readonly DialogStatus[];

export function isDialogStatus(value: string): value is DialogStatus {
  return (DIALOG_STATUSES as readonly string[]).includes(value);
}

/**
 * Пришло сообщение от клиента. Всегда `waiting_staff` — в том числе из
 * `closed`: новое обращение переоткрывает диалог (`Р-М-1`, поведение до
 * этапа 3 сохраняется, меняется только имя состояния).
 */
export function nextStatusOnInbound(): DialogStatus {
  return 'waiting_staff';
}

/**
 * Сотрудник ответил клиенту. Всегда `waiting_client` — даже если диалог был
 * закрыт: ответ означает, что разговор продолжается.
 *
 * ВНИМАНИЕ: внутренняя заметка (`direction = 'note'`, `У-209`) сюда **не
 * попадает** — у неё нет перехода вовсе. Иначе обсуждение между коллегами
 * снимало бы диалог с контроля SLA, ничего не ответив клиенту.
 */
export function nextStatusOnOutbound(): DialogStatus {
  return 'waiting_client';
}

/**
 * Момент, с которого диалог ждёт ответа сотрудника, — по нему считается
 * просрочка SLA (`Company.slaResponseHours`).
 *
 * Правила: вошли в `waiting_staff` — ставим, если ещё не стоял (несколько
 * сообщений подряд не двигают отсчёт: клиент ждёт с первого); вышли из
 * `waiting_staff` — сбрасываем.
 *
 * Отдельное поле, а не `lastInboundAt`: сотрудник мог ответить и тут же
 * получить новое входящее — тогда отсчёт начинается заново, а `lastInboundAt`
 * этих двух случаев не различает.
 */
export function waitingSinceFor(
  next: DialogStatus,
  currentWaitingSince: Date | null,
  now: Date
): Date | null {
  if (next !== 'waiting_staff') return null;
  return currentWaitingSince ?? now;
}

/**
 * Просрочен ли ответ: диалог ждёт сотрудника дольше, чем позволяет компания.
 * `waitingSince` без статуса `waiting_staff` не считается — это остаток
 * прошлого ожидания.
 */
export function dialogOverdueLevel(
  dialog: { status: string; waitingSince: Date | null },
  sla: { responseHours: number; warningHours: number },
  now: Date
): 'none' | 'warning' | 'overdue' {
  if (dialog.status !== 'waiting_staff' || !dialog.waitingSince) return 'none';
  const hours = (now.getTime() - dialog.waitingSince.getTime()) / 3_600_000;
  // Строго больше порога — ровно так же считает эскалация SLA
  // (`sla-escalation.ts`: `ageHours <= threshold` пропускается). Иначе ровно
  // на пороге диалог горел бы красным, а руководителю ничего не приходило.
  if (hours > sla.responseHours) return 'overdue';
  if (hours >= sla.warningHours) return 'warning';
  return 'none';
}
