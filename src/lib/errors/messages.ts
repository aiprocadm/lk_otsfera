/**
 * Single source of truth mapping stable service error codes (CLAUDE.md §3) to
 * user-facing Russian strings. Replaces per-form ERROR_LABEL_RU copies. Flat
 * map because §3 codes are globally-stable strings. Pure data — no React, lives
 * in lib so the UI imports it downward (§2 dependency direction).
 *
 * Seeded from partner + manager document-upload forms. Add codes from other
 * forms as they migrate to errorMessageRu().
 */
const RU: Record<string, string> = {
  validation: 'Проверьте поля формы.',
  forbidden: 'Нет прав на загрузку.',
  not_found: 'Заказ не найден.',
  too_large: 'Файл превышает допустимый размер.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  no_file: 'Файл не выбран.',
  network: 'Сетевая ошибка. Проверьте соединение и попробуйте снова.',
  invalid_recipient: 'У заказа нет партнёра — получатель «партнёр» недоступен.',
  invalid_credentials: 'Неверный email или пароль.',
  invalid_value: 'Некорректное значение дополнительного поля.',
  invalid_key: 'Ключ: только латиница, цифры и подчёркивание, начиная с буквы.',
  options_required: 'Для типов «выбор одного» и «множественный выбор» укажите хотя бы один вариант.',
  duplicate_key: 'Поле с таким ключом уже существует.',
  // Этап 1 ТЗ v0.5 (§11): настраиваемые поля пяти сущностей
  invalid_entity_type: 'Неизвестная сущность для настраиваемых полей.',
  reserved_key: 'Ключ занят системным полем — выберите другой.',
  // Этап 2 ТЗ v0.5 (§10): справочник статусов заявки
  system_protected: 'Системный статус изменить нельзя; использованный — только выключить.',
  anchor_taken: 'Событие уже привязано к другому статусу.',
  telegram_disabled: 'Telegram-уведомления не настроены администратором.',
  // Трек D — каналы уведомлений
  max_disabled: 'Max-уведомления не настроены администратором.',
  invalid_channel: 'Неизвестный канал уведомлений.',
  invalid_phone: 'Некорректный номер телефона.',
  phone_taken: 'Этот номер уже привязан к другому пользователю.',
  org_out_of_scope: 'Организация вне вашей зоны видимости.',
  already_rejected: 'Заявка уже отклонена.',
  already_promoted: 'Заявка уже переведена в заказ.',
  rate_out_of_range: 'Ставка должна быть в диапазоне (0, 1).',
  company_not_found: 'Компания не найдена.',
  requires_admin: 'Действие доступно только администратору организации.',
  already_member: 'Пользователь уже состоит в организации.',
  last_admin_protected: 'Нельзя удалить последнего администратора организации.',
  self_action_forbidden: 'Нельзя выполнить это действие над собой.',
  lifecycle_violation: 'Недопустимый переход статуса.',
  // throw→Result волна 2 (§3)
  email_taken: 'Пользователь с такой почтой уже зарегистрирован.',
  org_not_found: 'Организация не найдена.',
  user_not_found: 'Пользователь не найден.',
  role_conflict: 'Роль пользователя конфликтует с этим действием.',
  already_assigned: 'Пользователь уже назначен на эту организацию.',
  company_mismatch: 'Менеджер и организация принадлежат разным компаниям.',
  invalid_status: 'Недопустимый статус.',
  partner_not_found: 'Партнёр не найден.',
  period_overlap: 'Период пересекается с существующей ведомостью.',
  duplicate_slug: 'Партнёр с таким URL-идентификатором уже существует.',
  duplicate_email: 'Пользователь с такой почтой уже существует.',
  admin_role_via_ui: 'Роль администратора не выдаётся через интерфейс.',
  role_transition_forbidden: 'Такой переход роли запрещён.',
  // Task 11 — омниканальный инбокс (bindInboundMessageAction/replyInboundAction)
  invalid: 'Введите текст ответа.',
  reply_failed: 'Не удалось отправить ответ. Попробуйте ещё раз.',
  email_unsupported: 'Ответ по email пока не поддерживается — свяжитесь с клиентом другим каналом.',
  // R2 — инвентаризация недостающих кодов (grep по services/server-actions/api/worker):
  // до этого 36 кодов доходили до пользователя сырым fallback'ом.
  bad_request: 'Некорректный запрос.',
  invalid_request: 'Некорректный запрос.',
  order_not_found: 'Заказ не найден.',
  invalid_file: 'Файл не выбран или повреждён.',
  parse_failed: 'Не удалось разобрать файл. Проверьте формат.',
  empty: 'Файл не содержит данных для импорта.',
  infected: 'Файл не прошёл антивирусную проверку.',
  queue_unavailable: 'Фоновая обработка недоступна. Попробуйте позже.',
  too_many_requests: 'Слишком много запросов. Попробуйте позже.',
  invalid_token: 'Ссылка недействительна или устарела.',
  invalid_code: 'Код недействителен или истёк.',
  chat_taken: 'Этот чат уже привязан к другому пользователю.',
  thread_not_found: 'Диалог не найден.',
  empty_body: 'Введите текст сообщения.',
  reason_required: 'Укажите причину.',
  invalid_transition: 'Недопустимый переход.',
  invalid_stage: 'Этап воронки не найден.',
  invalid_state: 'Действие недоступно в текущем статусе.',
  position_taken: 'Позиция уже занята другим этапом.',
  duplicate_position: 'Позиция уже занята.',
  invalid_column: 'Колонка не найдена.',
  org_required: 'Сначала привяжите организацию.',
  forbidden_org: 'Нет доступа к этой организации.',
  name_taken: 'Название уже занято.',
  invalid_manager: 'Менеджер не найден или недоступен.',
  not_a_manager: 'Пользователь не является менеджером.',
  no_company: 'У пользователя не указана компания.',
  member_limit_reached: 'Достигнут лимит участников команды.',
  completion_conditions_unmet: 'Не выполнены условия завершения заказа.',
  student_mismatch: 'Слушатель принадлежит другой организации.',
  direction_inactive: 'Направление обучения неактивно.',
  unknown_entity: 'Неизвестная сущность синхронизации.',
  unknown_schedule: 'Неизвестное расписание.',
  already_running: 'Синхронизация уже запущена.',
  write_skipped: 'Запись пропущена (shadow-режим).',
  invalid_cursor: 'Некорректное значение курсора.',
  // Staff 2FA (спека 2026-07-11). invalid_code уже есть выше (telegram/max link
  // + 2FA делят код и текст «Код недействителен или истёк.»).
  email_send_failed: 'Не удалось отправить код на почту. Попробуйте ещё раз.',
  code_expired: 'Код истёк. Войдите заново.',
  too_many_attempts: 'Слишком много попыток. Войдите заново.',
  session_expired: 'Сессия входа истекла. Войдите заново.',
  not_staff: 'Пользователь не является сотрудником.',
  // login/2fa шлют UPPER_CASE-коды; login-form переводит их через toLowerCase()
  account_not_activated: 'Аккаунт не активирован. Перейдите по ссылке из письма-приглашения.',
  account_deactivated: 'Аккаунт деактивирован. Обратитесь к администратору.',
  inn_exists: 'Организация с таким ИНН уже есть в системе.'
};

export function errorMessageRu(code: string, fallback = 'Произошла ошибка.'): string {
  return RU[code] ?? fallback;
}
