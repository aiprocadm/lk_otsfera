import { log } from '@/lib/logging';
import { type AUDIT_ACTIONS, type AUDIT_ENTITIES } from '@/lib/auth/audit';

/**
 * Русские названия журнала аудита (ТЗ 2026-08-04 §6) — СЛОЙ ПРЕДСТАВЛЕНИЯ.
 *
 * В базе `action`/`entity` остаются машинными английскими значениями: миграции
 * данных нет, фильтры по-прежнему ходят по машинным кодам. Русским становится
 * только то, что видит человек.
 *
 * Полноту держит тест `lib.audit.labels`: каждый код из `AUDIT_ACTIONS` и
 * `AUDIT_ENTITIES` обязан иметь перевод. Записи типизированы как
 * `Record<AuditAction, string>` — добавить событие и «забыть» название нельзя,
 * это не соберётся.
 */

type AuditAction = (typeof AUDIT_ACTIONS)[number];
type AuditEntity = (typeof AUDIT_ENTITIES)[number];

const ACTION_LABELS: Record<AuditAction, string> = {
  '2fa_backup_regenerated': 'Перевыпуск кодов восстановления',
  '2fa_backup_used': 'Вход по коду восстановления',
  '2fa_code_sent': 'Отправка кода подтверждения',
  '2fa_failed': 'Неудачное подтверждение входа',
  '2fa_verified': 'Успешное подтверждение входа',
  STUDENT_BRIDGE_CLIENT_DENIED: 'Отказ площадке обучения',
  STUDENT_BRIDGE_CODE_EXCHANGED: 'Обмен кода перехода на доступ',
  STUDENT_BRIDGE_CODE_ISSUED: 'Выдача кода перехода в обучение',
  STUDENT_BRIDGE_CODE_REJECTED: 'Отклонён код перехода',
  STUDENT_BRIDGE_CODE_REUSE_BLOCKED: 'Заблокирован повторный код перехода',
  STUDENT_BRIDGE_RATE_LIMITED: 'Превышен лимит переходов в обучение',
  STUDENT_BRIDGE_TOKEN_ISSUED: 'Выдан пропуск в обучение',
  access_profile_created: 'Создание профиля доступа',
  access_profile_deleted: 'Удаление профиля доступа',
  access_profile_updated: 'Изменение профиля доступа',
  admin_bootstrapped: 'Создание первого администратора',
  cabinet_question_submitted: 'Вопрос из кабинета клиента',
  calendar_event_created: 'Создание события календаря',
  calendar_event_deleted: 'Удаление события календаря',
  calendar_event_updated: 'Изменение события календаря',
  call_bound: 'Привязка звонка к карточке',
  call_initiated: 'Исходящий звонок',
  certificate_created: 'Создание удостоверения',
  certificate_issued: 'Выдача удостоверения',
  certificate_scan_attached: 'Прикреплён скан удостоверения',
  client_request_attachment_deleted: 'Удаление вложения обращения',
  client_request_attachment_uploaded: 'Загрузка вложения обращения',
  client_request_converted: 'Обращение переведено в работу',
  client_request_rejected: 'Отклонение обращения',
  client_request_submitted: 'Подача обращения',
  client_request_taken: 'Обращение взято в работу',
  comment_posted: 'Комментарий к заказу',
  commission_correction_applied: 'Применение корректировки комиссии',
  commission_correction_waived: 'Отмена корректировки комиссии',
  commission_statement_approved: 'Утверждение отчёта по комиссии',
  commission_statement_calculated: 'Расчёт отчёта по комиссии',
  commission_statement_paid: 'Отметка об оплате комиссии',
  contact_created: 'Создание контакта',
  cursor_rewound: 'Откат курсора синхронизации',
  custom_field_definition_create: 'Создание дополнительного поля',
  custom_field_definition_deactivate: 'Отключение дополнительного поля',
  custom_field_definition_update: 'Изменение дополнительного поля',
  custom_field_values_set: 'Заполнение дополнительных полей',
  deal_created: 'Создание сделки',
  deal_note_created: 'Заметка по сделке',
  deal_stage_changed: 'Перевод сделки на другую стадию',
  deal_stage_created: 'Создание стадии сделок',
  deal_stage_deleted: 'Удаление стадии сделок',
  deal_stage_updated: 'Изменение стадии сделок',
  deal_updated: 'Изменение сделки',
  deal_won_order_created: 'Заказ по выигранной сделке',
  document_download_signed_url: 'Скачивание документа',
  document_generated: 'Формирование документа',
  document_upload: 'Загрузка документа',
  document_uploaded: 'Загрузка документа',
  enrollment_legacy_direction_assigned: 'Направление проставлено старой заявке',
  enrollment_approved: 'Одобрение заявки на обучение',
  enrollment_items_advanced: 'Продвижение позиций обучения',
  enrollment_provisioned: 'Зачисление на обучение',
  enrollment_rejected: 'Отклонение заявки на обучение',
  enrollment_submitted: 'Подача заявки на обучение',
  funnel_stage_created: 'Создание стадии воронки',
  funnel_stage_deleted: 'Удаление стадии воронки',
  funnel_stage_updated: 'Изменение стадии воронки',
  inbound_message_archived: 'Входящее сообщение в архив',
  inbound_message_bound: 'Привязка входящего сообщения',
  inbound_message_replied: 'Ответ на входящее сообщение',
  inbound_message_restored: 'Возврат сообщения из архива',
  intake_call_closed: 'Закрытие входящего звонка',
  intake_claimed: 'Взятие входящего в работу',
  integration_settings_updated: 'Изменение настроек интеграции',
  invite_resent: 'Повторная отправка приглашения',
  lead_assigned: 'Назначение ответственного за заявку',
  lead_created_from_call: 'Заявка из звонка',
  lead_created_from_inbound: 'Заявка из входящего сообщения',
  lead_created_manual: 'Создание заявки вручную',
  lead_promoted_to_deal: 'Заявка переведена в сделку',
  lead_promoted_to_order: 'Заявка переведена в заказ',
  lead_push_enqueued: 'Постановка заявки в очередь выгрузки',
  lead_rejected: 'Отклонение заявки',
  lead_status_changed: 'Смена статуса заявки',
  login: 'Вход в систему',
  manager_assigned: 'Назначение менеджера',
  manager_deactivated: 'Отключение менеджера',
  manager_reactivated: 'Возврат менеджера в работу',
  manager_role_changed: 'Изменение роли менеджера',
  manager_team_visibility_changed: 'Изменение видимости команды',
  max_linked: 'Привязка мессенджера Max',
  max_unlinked: 'Отвязка мессенджера Max',
  message_sent: 'Отправка сообщения',
  'feature_flag.changed': 'Переключение флага функциональности',
  'one_c_import.commit': 'Загрузка данных из 1С',
  'one_c_import.rollback': 'Откат импорта из 1С',
  one_c_pending_requeued: 'Повтор отложенной записи 1С',
  order_accounting_signed: 'Подписание закрывающих документов',
  order_deliverables_approved: 'Приёмка результата по заказу',
  order_item_added: 'Добавление позиции заказа',
  order_item_removed: 'Удаление позиции заказа',
  order_item_status_changed: 'Смена статуса позиции заказа',
  order_manager_changed: 'Смена менеджера заказа',
  order_result_delivered: 'Передача результата по заказу',
  order_self_assigned: 'Заказ взят в работу',
  order_status_changed: 'Смена статуса заказа',
  order_status_definition_create: 'Создание статуса заявок',
  order_status_definition_delete: 'Удаление статуса заявок',
  order_status_definition_update: 'Изменение статуса заявок',
  org_member_deactivated: 'Отключение сотрудника организации',
  org_member_invited: 'Приглашение сотрудника организации',
  org_member_reactivated: 'Возврат сотрудника организации',
  org_member_role_changed: 'Изменение роли сотрудника организации',
  organization_created_auto: 'Автосоздание организации из выгрузки 1С',
  organization_egrul_filled: 'Заполнение реквизитов из ЕГРЮЛ',
  organization_created_manual: 'Создание организации вручную',
  organization_rate_override: 'Индивидуальная ставка организации',
  organization_updated: 'Изменение организации',
  partner_commission_rate_changed: 'Изменение ставки партнёра',
  partner_created: 'Создание партнёра',
  partner_deactivated: 'Отключение партнёра',
  partner_member_deactivated: 'Отключение сотрудника партнёра',
  partner_member_invited: 'Приглашение сотрудника партнёра',
  partner_member_scope_changed: 'Изменение зоны видимости сотрудника партнёра',
  partner_reactivated: 'Возврат партнёра в работу',
  partner_updated: 'Изменение партнёра',
  password_reset: 'Сброс пароля',
  'payment_import.commit': 'Загрузка выписки по счёту',
  'payment_import.rollback': 'Откат импорта выписки',
  requisites_changed: 'Изменение реквизитов',
  sales_target_cleared: 'Снятие плана продаж',
  sales_target_set: 'Установка плана продаж',
  sessions_revoked: 'Завершение активных сессий',
  sla_settings_changed: 'Изменение настроек сроков (SLA)',
  staff_message_sent: 'Сообщение во внутреннем чате',
  student_created: 'Добавление сотрудника',
  student_deactivated: 'Деактивация сотрудника',
  student_updated: 'Изменение сотрудника',
  sync_dlq_bulk_retried: 'Повтор задач из очереди ошибок',
  sync_schedule_paused: 'Пауза расписания обмена',
  sync_schedule_resumed: 'Возобновление расписания обмена',
  sync_schedule_pattern_changed: 'Изменение расписания обмена',
  onec_params_changed: 'Изменение параметров обмена с 1С',
  alert_settings_changed: 'Изменение настроек оповещений',
  alert_test_sent: 'Отправка тестового оповещения',
  notification_rule_changed: 'Изменение правила уведомлений',
  notification_rules_reset: 'Возврат правил уведомлений к стандартным',
  login_policies_changed: 'Изменение политик входа',
  email_template_changed: 'Изменение текста письма',
  catalog_item_created: 'Добавление услуги в каталог',
  catalog_item_updated: 'Изменение услуги каталога',
  catalog_item_deactivated: 'Деактивация услуги каталога',
  catalog_item_activated: 'Возврат услуги в каталог',
  email_template_reset: 'Возврат стандартного текста письма',
  email_template_test_sent: 'Отправка пробного письма',
  sync_triggered: 'Ручной запуск обмена',
  task_assigned: 'Назначение исполнителя задачи',
  task_column_created: 'Создание колонки задач',
  task_column_deleted: 'Удаление колонки задач',
  task_column_updated: 'Изменение колонки задач',
  task_created: 'Создание задачи',
  task_deleted: 'Удаление задачи',
  task_moved: 'Перенос задачи',
  task_updated: 'Изменение задачи',
  telegram_linked: 'Привязка Telegram',
  telegram_unlinked: 'Отвязка Telegram',
  user_access_profile_assigned: 'Назначение профиля доступа',
  user_created: 'Создание пользователя',
  user_deactivated: 'Отключение пользователя',
  user_reactivated: 'Возврат пользователя в работу',
  user_role_changed: 'Изменение роли пользователя',
  user_updated: 'Изменение пользователя',
  whatsapp_phone_removed: 'Удаление номера WhatsApp',
  whatsapp_phone_saved: 'Сохранение номера WhatsApp',
};

const ENTITY_LABELS: Record<AuditEntity, string> = {
  access_profile: 'Профиль доступа',
  auth_2fa: 'Подтверждение входа',
  calendar_event: 'Событие календаря',
  call: 'Звонок',
  certificate: 'Удостоверение',
  client_request: 'Обращение клиента',
  client_request_attachment: 'Вложение обращения',
  commission_correction: 'Корректировка комиссии',
  commission_statement: 'Отчёт по комиссии',
  company: 'Юридическое лицо',
  contact: 'Контакт',
  custom_field_definition: 'Дополнительное поле',
  custom_field_value: 'Значение дополнительного поля',
  deal: 'Сделка',
  deal_stage: 'Стадия сделок',
  document: 'Документ',
  enrollment_request: 'Заявка на обучение',
  funnel_stage: 'Стадия воронки',
  inbound_message: 'Входящее сообщение',
  integration_setting: 'Настройка интеграции',
  catalog_item: 'Услуга каталога',
  job_queue: 'Очередь задач',
  lead: 'Заявка',
  lead_attachment: 'Вложение заявки',
  feature_flag: 'Флаг функциональности',
  one_c_import: 'Загрузка из 1С',
  one_c_pending: 'Отложенная запись 1С',
  order: 'Заказ',
  order_item: 'Позиция заказа',
  order_status_definition: 'Статус заявок',
  order_thread: 'Переписка по заказу',
  organization: 'Организация',
  organization_manager: 'Менеджер организации',
  organization_user: 'Сотрудник организации',
  partner: 'Партнёр',
  partner_user: 'Сотрудник партнёра',
  payment: 'Платёж',
  staff_conversation: 'Внутренняя переписка',
  student: 'Сотрудник',
  student_bridge: 'Переход в обучение',
  sync_schedule: 'Расписание обмена',
  alert_settings: 'Настройки оповещений',
  notification_rule: 'Правило уведомлений',
  email_template: 'Текст письма',
  login_policies: 'Политики входа',
  sync_state: 'Состояние обмена',
  task: 'Задача',
  task_column: 'Колонка задач',
  user: 'Пользователь',
};

/** Итог операции: пишется в `meta.status` каждой записи (`recordAudit`). */
const STATUS_LABELS: Record<string, string> = {
  success: 'Успешно',
  denied: 'Отказано в доступе',
  error: 'Ошибка',
};

/**
 * Названия полей в диффе «было → стало». Список неполный по своей природе
 * (поля приходят из `before`/`after` любых сущностей), поэтому здесь нет
 * exhaustive-типа и нет предупреждения в лог: незнакомое поле показывается как
 * есть — это данные, а не интерфейс.
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  email: 'Почта',
  phone: 'Телефон',
  role: 'Роль',
  status: 'Статус',
  isActive: 'Активен',
  inn: 'ИНН',
  kpp: 'КПП',
  ogrn: 'ОГРН',
  commissionRate: 'Ставка комиссии',
  totalAmount: 'Сумма',
  amount: 'Сумма',
  currency: 'Валюта',
  managerId: 'Менеджер',
  organizationId: 'Организация',
  partnerId: 'Партнёр',
  companyId: 'Юридическое лицо',
  orderId: 'Заказ',
  createdAt: 'Создано',
  updatedAt: 'Изменено',
  dueAt: 'Срок',
  title: 'Заголовок',
  description: 'Описание',
  comment: 'Комментарий',
  reason: 'Причина',
  scope: 'Зона видимости',
  capabilities: 'Права',
  accessProfileId: 'Профиль доступа',
  // Историческое поле: суб-роль managerRole снята программой ТЗ 2026-08-17
  // (PR-4), но записи AuditLog с ней остались в базе навсегда — без подписи
  // журнал показал бы машинный ключ. Парная подпись действия —
  // `manager_role_changed` выше, по той же причине.
  managerRole: 'Роль менеджера',
  roleInOrg: 'Роль в организации',
  legalName: 'Юридическое наименование',
  legalAddress: 'Юридический адрес',
  bankName: 'Банк',
  bankAccount: 'Расчётный счёт',
  corrAccount: 'Корреспондентский счёт',
  bic: 'БИК',
  signerName: 'Подписант',
  signerPosition: 'Должность подписанта',
  signerBasis: 'Основание полномочий',
  // `У-136`: дифф изменения услуги каталога (история цены). Ключ `article`,
  // а не `code`: диалог диффа маскирует поля по имени `code` (bridge-коды).
  article: 'Артикул',
  price: 'Цена',
  vatRate: 'Ставка НДС',
  vatIncluded: 'Цена включает НДС',
  unit: 'Единица измерения',
};

/** Заголовки колонок таблицы журнала (ТЗ §6.2). */
export const AUDIT_TABLE_HEADERS = {
  when: 'Когда',
  actor: 'Кто',
  action: 'Действие',
  entity: 'Объект',
  id: 'Идентификатор',
  result: 'Результат',
  detail: 'Детали',
} as const;

function fallback(kind: string, value: string): string {
  // Пробел в словаре — не повод показать пустоту: отдаём исходное значение и
  // помечаем в логе, чтобы дыру заметили и закрыли (ТЗ §6.4.1).
  log.warn('[audit] нет русского названия', { kind, value });
  return value;
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? fallback('action', action);
}

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity as AuditEntity] ?? fallback('entity', entity);
}

export function auditStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? fallback('status', status);
}

/** Название поля в диффе. Незнакомое поле — это данные: отдаём как есть, молча. */
export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Единый формат по всей таблице: ДД.ММ.ГГГГ ЧЧ:ММ:СС (ТЗ §6.4.3). */
export function formatAuditDateTime(value: Date): string {
  // Intl отдаёт «04.08.2026, 12:30:07» — запятую убираем, порядок уже верный.
  return DATE_TIME_FORMATTER.format(value).replace(', ', ' ');
}
