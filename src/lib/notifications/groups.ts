import type { NotificationTypeKey } from './registry';

/**
 * Группы в настройках уведомлений (этап 7 ТЗ 13.10.2026, `У-317`, `Р-7-5`):
 * сорок узких событий одной таблицей не читались. Порядок групп — порядок на
 * экране.
 */
export const NOTIFICATION_GROUPS = [
  { key: 'system', label: 'Системные' },
  { key: 'communication', label: 'Коммуникация' },
  { key: 'tasks', label: 'Задачи' },
  { key: 'orders', label: 'Заказы' },
  { key: 'enrollments', label: 'Заявки на обучение' },
] as const;

export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number]['key'];

/**
 * Группа каждого типа реестра. `Record` по всем ключам — страж полноты: новый
 * тип без группы не соберётся, и в настройках не появится «ничейная» строка.
 */
export const NOTIFICATION_TYPE_GROUP: Record<NotificationTypeKey, NotificationGroupKey> = {
  document_published: 'orders',
  payment_received: 'orders',
  order_status_changed: 'orders',
  manager_replied: 'communication',
  requisites_requested: 'orders',
  order_result_delivered: 'orders',
  chat_message: 'communication',
  document_accepted: 'orders',
  invoice_paid: 'orders',
  partner_material_published: 'system',
  commission_statement_ready: 'system',
  comment_from_org: 'communication',
  document_uploaded_by_org: 'orders',
  document_uploaded_by_partner: 'orders',
  order_status_changed_by_manager: 'orders',
  order_assigned: 'orders',
  order_marked_paid_by_1c: 'orders',
  client_request_submitted: 'communication',
  client_request_status_changed: 'communication',
  enrollment_submitted: 'enrollments',
  enrollment_status_changed: 'enrollments',
  task_assigned: 'tasks',
  task_due_soon: 'tasks',
  task_comment: 'tasks',
  task_overdue: 'tasks',
  sla_escalation: 'communication',
  automation_notice: 'system',
  automation_failed: 'system',
  staff_dm_message: 'communication',
  staff_chat_mention: 'communication',
  note_mention: 'communication',
  inbound_reply: 'communication',
  messenger_message: 'communication',
  dialog_assigned: 'communication',
  certificate_expiring: 'enrollments',
  training_assigned: 'enrollments',
  training_ending_soon: 'enrollments',
  calendar_event_reminder: 'tasks',
  sync_error: 'system',
  ops_alert: 'system',
  document_created: 'orders',
  message_created: 'communication',
};
