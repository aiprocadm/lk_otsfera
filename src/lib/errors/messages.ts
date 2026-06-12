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
  too_large: 'Файл превышает 20 МБ.',
  invalid_mime: 'Неподдерживаемый тип файла.',
  storage: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  no_file: 'Файл не выбран.',
  network: 'Сетевая ошибка. Проверьте соединение и попробуйте снова.',
  invalid_recipient: 'У заказа нет партнёра — получатель «партнёр» недоступен.',
  invalid_credentials: 'Неверный email или пароль.'
};

export function errorMessageRu(code: string, fallback = 'Произошла ошибка.'): string {
  return RU[code] ?? fallback;
}
