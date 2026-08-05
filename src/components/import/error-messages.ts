import { IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';

/**
 * Тексты ошибок обеих форм импорта (ТЗ починки импорта, Т-7).
 *
 * Список кодов один, а карты две: страница «Загрузка Excel» принимает только
 * `.xlsx`, страница выписки — ещё и `.xls`, поэтому подсказки разные.
 * `Record<ImportErrorCode, string>` намеренно exhaustive: новый код без текста
 * не соберётся, а не покажется пользователю как «Ошибка: parse_failed».
 *
 * Предел размера подставляется из константы — раньше «20 МБ» в тексте жило
 * своей жизнью и врало (реально резалось на 10 МБ).
 */
export const IMPORT_ERROR_CODES = [
  'forbidden',
  'invalid_file',
  'file_too_large',
  'empty',
  'parse_failed',
  'network_or_server',
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** Одинаковые для обеих форм: причина не зависит от того, какой файл ждали. */
const SHARED = {
  forbidden: 'Недостаточно прав',
  file_too_large: `Файл больше предела в ${IMPORT_MAX_FILE_MB} МБ. Выгрузите период поменьше (например, по кварталам) и загрузите файлы по очереди.`,
  parse_failed: 'Не удалось разобрать файл',
  network_or_server: `Сервер не принял файл. Проверьте размер (до ${IMPORT_MAX_FILE_MB} МБ) и попробуйте ещё раз. Если файл заведомо меньше — повторите через минуту.`,
} as const;

export const XLSX_IMPORT_ERRORS: Record<ImportErrorCode, string> = {
  ...SHARED,
  invalid_file: `Выберите файл .xlsx (не более ${IMPORT_MAX_FILE_MB} МБ)`,
  empty: 'Файл пуст или нет валидных строк',
};

export const PAYMENT_IMPORT_ERRORS: Record<ImportErrorCode, string> = {
  ...SHARED,
  invalid_file: `Выберите файл .xls или .xlsx (не более ${IMPORT_MAX_FILE_MB} МБ)`,
  empty: 'Файл пуст или нет строк-операций',
};

/** Неизвестный код показываем как есть — молчать хуже, чем показать код. */
export function errorMessage(map: Record<string, string>, code: string): string {
  return map[code] ?? `Ошибка: ${code}`;
}

/** Размер файла для подсказки пользователю: «Ваш файл — 34 МБ». */
export function fileSizeMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',');
}
