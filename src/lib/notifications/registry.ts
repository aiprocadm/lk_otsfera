/**
 * Этап 11 PR-3 (Модуль 15, ФТ-15.7) — единый реестр типов уведомлений.
 *
 * До него 19+ типов жили строковыми литералами в трёх файлах `notifications/*`
 * плюс в сервисах и воркерах, без общего списка и без русских подписей в одном
 * месте. Реестр — по образцу `PII_CONTEXTS` (`lib/pii/contexts.ts`):
 * ключ → подпись + аудитория + файл, который его отправляет. Полнота держится
 * guardrail-тестом `notifications.registry.guardrail`.
 *
 * `Notification.type` в схеме остаётся `String` — реестр это **контракт кода**,
 * а не enum БД. (Мёртвый `enum NotificationType` из схемы удалён этим же PR:
 * он не был связан ни с одной колонкой и не упоминался в коде.)
 *
 * **Про `new_client_request` из ФТ-15.7.** Тип с таким именем не заводится:
 * ровно это уведомление уже отправляется под именем `client_request_submitted`
 * (этап 5). Переименование осиротило бы исторические строки `Notification.type`
 * в БД ради косметики, поэтому имя ТЗ зафиксировано здесь псевдонимом
 * (`tzAlias`), а не миграцией данных.
 */

/** Кому адресован тип. `staff` — сотрудники без разделения на роли кабинета. */
export type NotificationAudience = 'organization' | 'partner' | 'manager' | 'staff' | 'admin';

export type NotificationTypeSpec = {
  /** Русская подпись типа — единственный источник для UI и писем. */
  label: string;
  audience: NotificationAudience[];
  /** Файл, который отправляет тип (проверяется guardrail'ом). */
  producer: string;
  /**
   * Этап 5 (`У-233`): значок типа для ленты и фильтра страницы «Уведомления».
   * Обязателен — тип без значка не соберётся, а страж полноты не даст
   * оставить пустую строку. Значок здесь, а не в компоненте: подпись и знак
   * должны жить рядом, иначе разъедутся при первом новом типе.
   */
  icon: string;
  /**
   * Этап 5 PR-3 (`Р-Э5-5`): каждое событие — отдельная строка, окно дедупа
   * 60 минут не применяется. Только для типов, где каждый повтор важен сам
   * по себе (сообщения).
   */
  noDedup?: true;
  /** Имя из ТЗ, если оно отличается от исторического кода. */
  tzAlias?: string;
};

export const NOTIFICATION_TYPES = {
  // ── Клиентский контур: организация ──────────────────────────────────────
  document_published: {
    label: 'Опубликован документ',
    icon: '📄',
    audience: ['organization', 'partner'],
    producer: 'src/lib/notifications/org.ts',
  },
  payment_received: {
    label: 'Поступила оплата',
    icon: '💰',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  order_status_changed: {
    label: 'Изменился статус заказа',
    icon: '📋',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  manager_replied: {
    label: 'Менеджер ответил на комментарий',
    icon: '💬',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  requisites_requested: {
    label: 'Запрошены реквизиты',
    icon: '🧾',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  order_result_delivered: {
    label: 'Результат по заказу передан',
    icon: '📦',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  chat_message: {
    noDedup: true,
    label: 'Новое сообщение в чате',
    icon: '💬',
    audience: ['organization', 'manager'],
    producer: 'src/lib/notifications/org.ts',
  },
  document_accepted: {
    label: 'Заказчик принял документ',
    icon: '✅',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  invoice_paid: {
    label: 'Счёт оплачен',
    icon: '💰',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },

  // ── Клиентский контур: партнёр ──────────────────────────────────────────
  commission_statement_ready: {
    label: 'Готов отчёт по комиссии',
    icon: '📊',
    audience: ['partner'],
    producer: 'src/lib/notifications/partner.ts',
  },

  // ── Менеджеру по заказу ─────────────────────────────────────────────────
  comment_from_org: {
    label: 'Комментарий от клиента',
    icon: '💬',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  document_uploaded_by_org: {
    label: 'Организация загрузила документ',
    icon: '📎',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  document_uploaded_by_partner: {
    label: 'Партнёр загрузил документ',
    icon: '📎',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  order_marked_paid_by_1c: {
    label: 'Заказ оплачен (по данным 1С)',
    icon: '💰',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  order_status_changed_by_manager: {
    label: 'Коллега изменил статус заказа',
    icon: '📋',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },

  // ── Заявки клиентов (Модуль 1) ──────────────────────────────────────────
  client_request_submitted: {
    label: 'Новая заявка клиента',
    icon: '📮',
    audience: ['manager'],
    producer: 'src/lib/services/clientRequests/notify.ts',
    tzAlias: 'new_client_request',
  },
  client_request_status_changed: {
    label: 'Изменился статус заявки',
    icon: '📮',
    audience: ['organization', 'partner'],
    producer: 'src/lib/services/clientRequests/notify.ts',
  },

  // ── Заявки на обучение (Модуль 2) ───────────────────────────────────────
  enrollment_submitted: {
    label: 'Подана заявка на обучение',
    icon: '🎓',
    audience: ['manager'],
    producer: 'src/lib/services/enrollments/notify.ts',
  },
  enrollment_status_changed: {
    label: 'Изменился статус заявки на обучение',
    icon: '🎓',
    audience: ['organization', 'partner'],
    producer: 'src/lib/services/enrollments/notify.ts',
  },

  // ── Внутренние задачи и SLA (Модули 7, 4.4) ─────────────────────────────
  task_assigned: {
    label: 'Назначена задача',
    icon: '✔',
    audience: ['staff'],
    producer: 'src/lib/services/tasks/notify.ts',
  },
  task_due_soon: {
    label: 'Срок задачи подходит',
    icon: '⏰',
    audience: ['staff'],
    producer: 'src/worker/processors/task-due-soon.ts',
  },
  // Этап 4 ТЗ 12.09.2026 (`У-218`): обсуждение внутри задачи. Упомянутые по `@`
  // получают `note_mention` и в эту рассылку не попадают — два уведомления об
  // одной строке были бы шумом, от которого уведомления выключают целиком.
  task_comment: {
    label: 'Новый комментарий в задаче',
    icon: '💬',
    audience: ['staff'],
    producer: 'src/lib/services/tasks/comments.ts',
  },
  // Этап 4 (`У-225`): задача просрочена. Два разных повода в одном типе —
  // исполнителю в день просрочки и руководителю на N-й; различает их текст.
  task_overdue: {
    label: 'Задача просрочена',
    icon: '⏰',
    audience: ['staff'],
    producer: 'src/worker/processors/sla-escalation.ts',
  },
  sla_escalation: {
    label: 'Просрочен ответ по SLA',
    icon: '🚨',
    audience: ['staff'],
    producer: 'src/worker/processors/sla-escalation.ts',
  },
  // Этап 4 (`У-222`): сообщение, которое послало правило автоматизации.
  // Отдельный тип, а не чужой: человек должен видеть, что это робот, и знать,
  // какое правило выключить, если сообщений слишком много.
  automation_notice: {
    label: 'Сообщение от правила автоматизации',
    icon: '🤖',
    audience: ['staff'],
    producer: 'src/lib/automation/actions.ts',
  },
  // Этап 4 (`У-223`, §9 пакета): правило сломалось — например, ссылается на
  // удалённый статус. Молчащий робот хуже отсутствующего.
  automation_failed: {
    label: 'Правило автоматизации не сработало',
    icon: '🤖',
    audience: ['staff'],
    producer: 'src/worker/processors/automation-run.ts',
  },

  // ── Внутренние коммуникации сотрудников ─────────────────────────────────
  staff_dm_message: {
    // Сообщение служебного чата — как chat_message: каждое своей строкой.
    noDedup: true,
    label: 'Личное сообщение сотруднику',
    icon: '✉',
    audience: ['staff'],
    producer: 'src/lib/services/staffChat/messages.ts',
  },
  staff_chat_mention: {
    // Сообщение служебного чата — как chat_message: каждое своей строкой.
    noDedup: true,
    label: 'Упоминание в чате сотрудников',
    icon: '💬',
    audience: ['staff'],
    producer: 'src/lib/services/staffChat/messages.ts',
  },
  // Этап 1 ТЗ 12.09.2026 (`У-183`, спека §3.6): один тип для заметки по сделке
  // и по организации — `meta.entity` различает объект. Прежний ключ
  // `deal_note_mention` переехал в правилах доставки миграцией, для
  // исторических строк `Notification.type` остаётся псевдонимом ниже.
  note_mention: {
    label: 'Упоминание в заметке',
    icon: '📝',
    audience: ['staff'],
    producer: 'src/lib/notifications/noteMention.ts',
  },
  inbound_reply: {
    // Ответ клиенту — свой текст, как сообщение: повтор «×2» потерял бы второй ответ.
    noDedup: true,
    label: 'Ответ по внешнему обращению',
    icon: '✉',
    audience: ['staff'],
    producer: 'src/lib/services/inbound/reply.ts',
  },
  // Спека 2026-09-12 (Р-М-9): клиент написал в диалог мессенджера — менеджерам
  // организации, к которой привязан диалог.
  messenger_message: {
    noDedup: true,
    label: 'Новое сообщение в мессенджере',
    icon: '📱',
    audience: ['staff'],
    producer: 'src/lib/notifications/manager.ts',
  },
  // Этап 3 (`У-206`): диалог назначили на сотрудника — он узнаёт об этом сам,
  // а не обнаруживает переписку случайно в общем списке.
  dialog_assigned: {
    label: 'Вас назначили ответственным за диалог',
    icon: '📱',
    audience: ['staff'],
    producer: 'src/lib/notifications/manager.ts',
  },

  // ── Фоновые процессы ────────────────────────────────────────────────────
  certificate_expiring: {
    label: 'Истекает удостоверение',
    icon: '🎫',
    audience: ['organization', 'partner'],
    producer: 'src/worker/processors/certificate-expiry.ts',
  },
  calendar_event_reminder: {
    label: 'Напоминание о событии календаря',
    icon: '📅',
    audience: ['staff'],
    producer: 'src/worker/processors/calendar-reminder.ts',
  },
  sync_error: {
    label: 'Ошибка обмена с 1С',
    icon: '⚠',
    audience: ['staff'],
    // Второй продьюсер того же типа — `push-document.ts` (`У-174`: документ
    // не выгружен в 1С после последней попытки); реестр хранит один якорь.
    producer: 'src/worker/processors/push-lead.ts',
  },
  ops_alert: {
    label: 'Оповещение мониторинга',
    icon: '🚨',
    audience: ['admin'],
    producer: 'src/lib/monitoring/deliver.ts',
  },

  // ── Универсальные (core) ────────────────────────────────────────────────
  document_created: {
    label: 'Создан документ',
    icon: '📄',
    audience: ['staff'],
    producer: 'src/lib/services/documents/adminUpload.ts',
  },
  message_created: {
    label: 'Новое сообщение',
    icon: '✉',
    audience: ['staff'],
    producer: 'src/lib/services/comments/post.ts',
  },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;

/** Известен ли тип реестру. */
export function isKnownNotificationType(type: string): type is NotificationTypeKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type);
}

/**
 * Псевдонимы прежних ключей → действующий тип. Исторические строки
 * `Notification.type` не переименовываем (прецедент `tzAlias`: данные ради
 * косметики не трогаем), но подпись для них берём у нового типа.
 */
export const LEGACY_NOTIFICATION_TYPE_ALIASES: Readonly<Record<string, NotificationTypeKey>> = {
  deal_note_mention: 'note_mention',
};

/**
 * Русская подпись типа. Неизвестный тип не ломает экран — возвращаем сам код,
 * чтобы уведомление всё равно было видно (fail-open, §3 CLAUDE.md).
 */
export function notificationLabelRu(type: string): string {
  const key = LEGACY_NOTIFICATION_TYPE_ALIASES[type] ?? type;
  return isKnownNotificationType(key) ? NOTIFICATION_TYPES[key].label : type;
}

/** Типы, адресованные конкретной аудитории. */
/**
 * Роли кабинетов → аудитории реестра (`У-228`, `У-233`). Одно место, потому
 * что фильтр страницы, матрица личных настроек и маршруты строятся по нему.
 *
 * Руководитель получает всё менеджерское: рассылки `notifyManagers` идут
 * сотрудникам контура без разбора должности. Слушателю не адресован ни один
 * тип — его страница всегда пуста, и это записано решением `Р-Э5-1`.
 */
export type NotificationRoleKey =
  'admin' | 'leader' | 'manager' | 'partner' | 'organization' | 'student';

const ROLE_AUDIENCES: Record<NotificationRoleKey, NotificationAudience[]> = {
  admin: ['admin', 'staff'],
  leader: ['manager', 'staff'],
  manager: ['manager', 'staff'],
  partner: ['partner'],
  organization: ['organization'],
  student: [],
};

/**
 * Аудитория реестра, под которой роль получает событие, — для правил компании
 * (`NotificationRule` ключуется аудиторией). `null` — событие роли не адресовано.
 */
export function notificationAudienceForRole(
  type: NotificationTypeKey,
  role: NotificationRoleKey
): NotificationAudience | null {
  const wanted = ROLE_AUDIENCES[role];
  return NOTIFICATION_TYPES[type].audience.find((a) => wanted.includes(a)) ?? null;
}

/** Типы, которые может получить роль, — в порядке реестра, без повторов. */
export function notificationTypesForRole(role: NotificationRoleKey): NotificationTypeKey[] {
  const wanted = ROLE_AUDIENCES[role];
  return (Object.keys(NOTIFICATION_TYPES) as NotificationTypeKey[]).filter((key) =>
    NOTIFICATION_TYPES[key].audience.some((a) => wanted.includes(a))
  );
}

export function notificationTypesFor(audience: NotificationAudience): NotificationTypeKey[] {
  return (Object.keys(NOTIFICATION_TYPES) as NotificationTypeKey[]).filter((key) =>
    (NOTIFICATION_TYPES[key].audience as readonly NotificationAudience[]).includes(audience)
  );
}
