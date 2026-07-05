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
  options_required: 'Для типа «список» укажите хотя бы один вариант.',
  duplicate_key: 'Поле с таким ключом уже существует.',
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
  email_unsupported: 'Ответ по email пока не поддерживается — свяжитесь с клиентом другим каналом.'
};

export function errorMessageRu(code: string, fallback = 'Произошла ошибка.'): string {
  return RU[code] ?? fallback;
}
