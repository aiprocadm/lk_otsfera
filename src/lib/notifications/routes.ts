import type { NotificationRoleKey, NotificationTypeKey } from './registry';

/**
 * Таблица маршрутов уведомлений «тип × роль → адрес» (этап 5 PR-3, `У-232`,
 * решение `Р-Э5-7`).
 *
 * Ссылка считается от РОЛИ ПОЛУЧАТЕЛЯ по идентификаторам из `meta`
 * (`orderId`, `taskId`, `dialogId`, …), а не хранится в строке с кабинетом.
 * До этапа продьюсеры сотрудников писали `/manager/…` всем подряд, и
 * руководитель из письма попадал в чужой кабинет; старые строки в базе с
 * таким `url` тоже лечатся — для сотрудников таблица важнее `meta.url`
 * (см. `href.ts`).
 *
 * Правила:
 * - объект есть в кабинете роли → карточка объекта; карточки нет — список
 *   раздела; раздела нет — `null` (такие пары перечислены в страже явно);
 * - руководитель ходит в `/leader/…` везде, где раздел у него есть
 *   (`У-232`); разделы «Мессенджеры» и «Входящие» существуют только в
 *   кабинете менеджера, и руководитель заходит туда как «играющий тренер»
 *   (CLAUDE.md §4) — единственное записанное исключение;
 * - слушателю ни один тип не адресован — всегда `null`;
 * - страж `notifications.routes` проверяет по файлам `src/app`, что каждый
 *   выданный адрес существует.
 */

type Cabinet = Exclude<NotificationRoleKey, 'student'>;
type Meta = Record<string, unknown> | null;

/** Разделы, по которым таблица строит адреса. Ключ — сегмент пути. */
type Section =
  | 'orders'
  | 'documents'
  | 'tasks'
  | 'messengers'
  | 'inbox'
  | 'requests'
  | 'enrollments'
  | 'contacts'
  | 'organizations'
  | 'deals'
  | 'leads'
  | 'calendar'
  | 'messages'
  | 'certificates'
  | 'finance'
  | 'commission-statements'
  | 'calls'
  | 'sync';

/** Разделы кабинета: `true` — есть и список, и карточка `[id]`; `false` — только список. */
const CABINET_SECTIONS: Record<Cabinet, Partial<Record<Section, boolean>>> = {
  admin: {
    orders: true,
    documents: true,
    requests: true,
    enrollments: true,
    contacts: true,
    organizations: true,
    messages: false,
    'commission-statements': true,
    sync: false,
  },
  leader: {
    orders: true,
    documents: true,
    tasks: true,
    requests: true,
    enrollments: true,
    contacts: true,
    organizations: true,
    deals: false,
    calendar: false,
    messages: false,
    finance: false,
  },
  manager: {
    orders: true,
    documents: true,
    tasks: true,
    messengers: true,
    inbox: false,
    calls: false,
    requests: true,
    enrollments: true,
    contacts: true,
    organizations: true,
    deals: false,
    leads: true,
    calendar: false,
    messages: false,
    finance: false,
  },
  partner: {
    orders: true,
    documents: true,
    requests: true,
    enrollments: true,
    deals: true,
    certificates: false,
    finance: false,
    messages: false,
  },
  organization: {
    orders: true,
    documents: true,
    requests: true,
    enrollments: true,
    certificates: false,
    finance: false,
    messages: false,
  },
};

/** Разделы, в которые руководитель заходит через кабинет менеджера (играющий тренер). */
const COACH_SECTIONS: ReadonlySet<Section> = new Set(['messengers', 'inbox', 'calls']);

function idOf(meta: Meta, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function strOf(meta: Meta, key: string): string | null {
  const v = meta?.[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Адрес объекта раздела для кабинета: карточка, если она есть и есть id;
 * иначе список (с хвостом `query`, если задан); раздела нет — `null`.
 */
function section(
  cabinet: Cabinet,
  name: Section,
  id: string | null,
  query?: string
): string | null {
  let cab: Cabinet = cabinet;
  let has = CABINET_SECTIONS[cabinet][name];
  if (has === undefined && cabinet === 'leader' && COACH_SECTIONS.has(name)) {
    cab = 'manager';
    has = CABINET_SECTIONS.manager[name];
  }
  if (has === undefined) return null;
  const base = `/${cab}/${name}`;
  if (has && id) return `${base}/${id}`;
  return query ? `${base}?${query}` : base;
}

type Rule = (meta: Meta, cabinet: Cabinet) => string | null;

const order: Rule = (m, c) => section(c, 'orders', idOf(m, 'orderId'));
const task: Rule = (m, c) => section(c, 'tasks', idOf(m, 'taskId'));
const dialog: Rule = (m, c) => section(c, 'messengers', idOf(m, 'dialogId'));
const request: Rule = (m, c) => section(c, 'requests', idOf(m, 'requestId'));
const enrollment: Rule = (m, c) => section(c, 'enrollments', idOf(m, 'requestId'));
const document: Rule = (m, c) => section(c, 'documents', idOf(m, 'documentId'));
const messages: Rule = (_m, c) => section(c, 'messages', null);
/**
 * Документ для сотрудника: сначала заказ (контекст «по какому заказу» важнее),
 * потом карточка документа (без заказа), потом общие документы.
 */
const orderOrDocument: Rule = (m, c) =>
  idOf(m, 'orderId')
    ? order(m, c)
    : idOf(m, 'documentId')
      ? document(m, c)
      : section(c, 'documents', null, 'tab=general');
/** Документ для клиента: его карточка, если id известен; иначе заказ; иначе общие документы. */
const documentOrOrder: Rule = (m, c) =>
  idOf(m, 'documentId')
    ? document(m, c)
    : idOf(m, 'orderId')
      ? order(m, c)
      : section(c, 'documents', null, 'tab=general');

/** Источники SLA-эскалации (`sla-escalation.ts`, `sourceType`) → раздел. */
const SLA_SOURCE: Record<string, Section> = {
  client_request: 'requests',
  enrollment: 'enrollments',
  inbound: 'inbox',
  call: 'calls',
  dialog: 'messengers',
};

const RULES: Record<NotificationTypeKey, Rule> = {
  // ── Заказчик и партнёр ──
  document_published: documentOrOrder,
  payment_received: order,
  order_status_changed: order,
  manager_replied: order,
  requisites_requested: (_m, c) => (c === 'organization' ? '/organization/settings' : null),
  order_result_delivered: order,
  commission_statement_ready: (m, c) =>
    c === 'partner'
      ? section(c, 'finance', null)
      : section(c, 'commission-statements', idOf(m, 'statementId')),
  client_request_status_changed: request,
  enrollment_status_changed: enrollment,
  certificate_expiring: (_m, c) => section(c, 'certificates', null),

  // ── Заказ: клиент ↔ менеджер ──
  chat_message: order,
  document_accepted: order,
  invoice_paid: order,
  comment_from_org: order,
  document_uploaded_by_org: orderOrDocument,
  document_uploaded_by_partner: orderOrDocument,
  order_marked_paid_by_1c: order,
  order_status_changed_by_manager: order,
  message_created: order,
  document_created: document,

  // ── Заявки и обучения ──
  client_request_submitted: request,
  enrollment_submitted: enrollment,

  // ── Задачи ──
  task_assigned: task,
  task_due_soon: task,
  task_comment: task,
  task_overdue: task,

  // ── Диалоги ──
  messenger_message: dialog,
  dialog_assigned: dialog,
  inbound_reply: (m, c) => (idOf(m, 'dialogId') ? dialog(m, c) : section(c, 'inbox', null)),

  // ── Служебный чат и заметки ──
  staff_dm_message: messages,
  staff_chat_mention: messages,
  note_mention: (m, c) => {
    switch (strOf(m, 'entity')) {
      case 'deal':
        // У сделки своей карточки у сотрудников нет — ведём в заказ, если он есть.
        return idOf(m, 'orderId') ? order(m, c) : section(c, 'deals', null);
      case 'organization': {
        const card = section(c, 'organizations', idOf(m, 'organizationId'));
        return card && idOf(m, 'organizationId') ? `${card}?tab=notes` : card;
      }
      case 'dialog':
        return dialog(m, c);
      case 'task':
        return task(m, c);
      default:
        return null;
    }
  },

  // ── Автоматизация, SLA, календарь ──
  sla_escalation: (m, c) => {
    const sec = SLA_SOURCE[strOf(m, 'sourceType') ?? ''];
    if (!sec) return null;
    const raw = idOf(m, 'sourceId');
    // У диалога `sourceId` составной — «<dialogId>:<начало ожидания>» (журнал
    // эскалаций уникален по паре, см. sla-escalation.ts): карточке нужен только id.
    const id = sec === 'messengers' && raw ? raw.split(':')[0] || null : raw;
    // «Входящие» — список с живым фильтром по строке (`?message=`), карточки нет.
    if (sec === 'inbox') return section(c, sec, null, id ? `message=${id}` : undefined);
    return section(c, sec, id);
  },
  automation_notice: (m, c) => {
    switch (strOf(m, 'entity')) {
      case 'task':
        return section(c, 'tasks', idOf(m, 'entityId'));
      case 'order':
        return section(c, 'orders', idOf(m, 'entityId'));
      case 'dialog':
        return section(c, 'messengers', idOf(m, 'entityId'));
      case 'lead':
        return section(c, 'leads', idOf(m, 'entityId'));
      case 'deal':
        return section(c, 'deals', null);
      case 'document':
        return section(c, 'documents', idOf(m, 'entityId'));
      case 'client_request':
        return section(c, 'requests', idOf(m, 'entityId'));
      case 'payment':
        return section(c, 'finance', null);
      default:
        return null;
    }
  },
  automation_failed: (_m, c) =>
    c === 'admin' || c === 'leader' ? `/${c}/settings/processes/automation` : null,
  calendar_event_reminder: (_m, c) => section(c, 'calendar', null),

  // ── Обмен и мониторинг ──
  sync_error: (m, c) => {
    switch (strOf(m, 'kind')) {
      case 'push_document_failed':
        return document(m, c);
      case 'push_lead_failed':
        // У партнёра нет раздела заявок в 1С — строка остаётся без ссылки.
        return null;
      default:
        if (c === 'admin') return '/admin/sync';
        if (c === 'leader') return '/leader/settings/integrations';
        return null;
    }
  },
  ops_alert: (_m, c) => (c === 'admin' ? '/admin/settings/system/health' : null),
};

/**
 * Адресованные пары «тип × роль», для которых `null` — ожидаемый ответ: у роли
 * нет такого раздела. Страж сверяет список с таблицей в обе стороны.
 */
export const NOTIFICATION_ROUTE_GAPS: ReadonlyArray<readonly [NotificationTypeKey, Cabinet]> = [
  // У администратора нет задач, диалогов, входящих и календаря (Model A —
  // он не работает в кабинете менеджера).
  ['task_assigned', 'admin'],
  ['task_due_soon', 'admin'],
  ['task_comment', 'admin'],
  ['task_overdue', 'admin'],
  ['messenger_message', 'admin'],
  ['dialog_assigned', 'admin'],
  ['inbound_reply', 'admin'],
  ['calendar_event_reminder', 'admin'],
  // Те же разделы, но объект приходит в meta: эскалация по диалогу, заметка к
  // задаче, правило по задаче/диалогу — админу вести некуда.
  ['sla_escalation', 'admin'],
  ['note_mention', 'admin'],
  ['automation_notice', 'admin'],
  // Правила автоматизации настраивают админ и руководитель. (`sync_error`
  // менеджеру приходит только про документ — и ведёт в его карточку.)
  ['automation_failed', 'manager'],
];

function isNotificationTypeKey(type: string): type is NotificationTypeKey {
  return Object.prototype.hasOwnProperty.call(RULES, type);
}

/**
 * Локальный путь по типу, `meta` и роли получателя; `null` — раздела у роли
 * нет или в `meta` нет идентификатора, а списка раздела тоже нет.
 */
export function notificationRoute(
  type: string,
  meta: unknown,
  role: NotificationRoleKey | string
): string | null {
  if (!isNotificationTypeKey(type)) return null;
  if (!(role in CABINET_SECTIONS)) return null;
  const m = meta !== null && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;
  return RULES[type](m, role as Cabinet);
}

/** Все типы таблицы — для стража, чтобы перебрать каждую пару «тип × роль». */
export const NOTIFICATION_ROUTE_TYPES = Object.keys(RULES) as NotificationTypeKey[];
export const NOTIFICATION_ROUTE_CABINETS = Object.keys(CABINET_SECTIONS) as Cabinet[];
