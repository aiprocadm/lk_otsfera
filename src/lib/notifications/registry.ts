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
  /** Имя из ТЗ, если оно отличается от исторического кода. */
  tzAlias?: string;
};

export const NOTIFICATION_TYPES = {
  // ── Клиентский контур: организация ──────────────────────────────────────
  document_published: {
    label: 'Опубликован документ',
    audience: ['organization', 'partner'],
    producer: 'src/lib/notifications/org.ts',
  },
  payment_received: {
    label: 'Поступила оплата',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  order_status_changed: {
    label: 'Изменился статус заказа',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  manager_replied: {
    label: 'Менеджер ответил на комментарий',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  requisites_requested: {
    label: 'Запрошены реквизиты',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  order_result_delivered: {
    label: 'Результат по заказу передан',
    audience: ['organization'],
    producer: 'src/lib/notifications/org.ts',
  },
  chat_message: {
    label: 'Новое сообщение в чате',
    audience: ['organization', 'manager'],
    producer: 'src/lib/notifications/org.ts',
  },

  // ── Клиентский контур: партнёр ──────────────────────────────────────────
  commission_statement_ready: {
    label: 'Готов отчёт по комиссии',
    audience: ['partner'],
    producer: 'src/lib/notifications/partner.ts',
  },

  // ── Менеджеру по заказу ─────────────────────────────────────────────────
  comment_from_org: {
    label: 'Комментарий от клиента',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  document_uploaded_by_org: {
    label: 'Организация загрузила документ',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  document_uploaded_by_partner: {
    label: 'Партнёр загрузил документ',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  order_marked_paid_by_1c: {
    label: 'Заказ оплачен (по данным 1С)',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },
  order_status_changed_by_manager: {
    label: 'Коллега изменил статус заказа',
    audience: ['manager'],
    producer: 'src/lib/notifications/manager.ts',
  },

  // ── Заявки клиентов (Модуль 1) ──────────────────────────────────────────
  client_request_submitted: {
    label: 'Новая заявка клиента',
    audience: ['manager'],
    producer: 'src/lib/services/clientRequests/notify.ts',
    tzAlias: 'new_client_request',
  },
  client_request_status_changed: {
    label: 'Изменился статус заявки',
    audience: ['organization', 'partner'],
    producer: 'src/lib/services/clientRequests/notify.ts',
  },

  // ── Заявки на обучение (Модуль 2) ───────────────────────────────────────
  enrollment_submitted: {
    label: 'Подана заявка на обучение',
    audience: ['manager'],
    producer: 'src/lib/services/enrollments/notify.ts',
  },
  enrollment_status_changed: {
    label: 'Изменился статус заявки на обучение',
    audience: ['organization', 'partner'],
    producer: 'src/lib/services/enrollments/notify.ts',
  },

  // ── Внутренние задачи и SLA (Модули 7, 4.4) ─────────────────────────────
  task_assigned: {
    label: 'Назначена задача',
    audience: ['staff'],
    producer: 'src/lib/services/tasks/notify.ts',
  },
  task_due_soon: {
    label: 'Срок задачи подходит',
    audience: ['staff'],
    producer: 'src/worker/processors/task-due-soon.ts',
  },
  sla_escalation: {
    label: 'Просрочен ответ по SLA',
    audience: ['staff'],
    producer: 'src/worker/processors/sla-escalation.ts',
  },

  // ── Внутренние коммуникации сотрудников ─────────────────────────────────
  staff_dm_message: {
    label: 'Личное сообщение сотруднику',
    audience: ['staff'],
    producer: 'src/lib/services/staffChat/messages.ts',
  },
  staff_chat_mention: {
    label: 'Упоминание в чате сотрудников',
    audience: ['staff'],
    producer: 'src/lib/services/staffChat/messages.ts',
  },
  deal_note_mention: {
    label: 'Упоминание в заметке по сделке',
    audience: ['staff'],
    producer: 'src/lib/services/manager/dealNotes.ts',
  },
  inbound_reply: {
    label: 'Ответ по внешнему обращению',
    audience: ['staff'],
    producer: 'src/lib/services/inbound/reply.ts',
  },

  // ── Фоновые процессы ────────────────────────────────────────────────────
  certificate_expiring: {
    label: 'Истекает удостоверение',
    audience: ['organization', 'partner'],
    producer: 'src/worker/processors/certificate-expiry.ts',
  },
  calendar_event_reminder: {
    label: 'Напоминание о событии календаря',
    audience: ['staff'],
    producer: 'src/worker/processors/calendar-reminder.ts',
  },
  sync_error: {
    label: 'Ошибка обмена с 1С',
    audience: ['staff'],
    producer: 'src/worker/processors/push-lead.ts',
  },
  ops_alert: {
    label: 'Оповещение мониторинга',
    audience: ['admin'],
    producer: 'src/lib/monitoring/deliver.ts',
  },

  // ── Универсальные (core) ────────────────────────────────────────────────
  document_created: {
    label: 'Создан документ',
    audience: ['staff'],
    producer: 'src/lib/notifications/core.ts',
  },
  status_changed: {
    label: 'Изменился статус',
    audience: ['staff'],
    producer: 'src/lib/notifications/core.ts',
  },
  message_created: {
    label: 'Новое сообщение',
    audience: ['staff'],
    producer: 'src/lib/notifications/core.ts',
  },
} as const satisfies Record<string, NotificationTypeSpec>;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;

/** Известен ли тип реестру. */
export function isKnownNotificationType(type: string): type is NotificationTypeKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type);
}

/**
 * Русская подпись типа. Неизвестный тип не ломает экран — возвращаем сам код,
 * чтобы уведомление всё равно было видно (fail-open, §3 CLAUDE.md).
 */
export function notificationLabelRu(type: string): string {
  return isKnownNotificationType(type) ? NOTIFICATION_TYPES[type].label : type;
}

/** Типы, адресованные конкретной аудитории. */
export function notificationTypesFor(audience: NotificationAudience): NotificationTypeKey[] {
  return (Object.keys(NOTIFICATION_TYPES) as NotificationTypeKey[]).filter((key) =>
    (NOTIFICATION_TYPES[key].audience as readonly NotificationAudience[]).includes(audience)
  );
}
