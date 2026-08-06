import { IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';

/**
 * Тексты ошибок обеих форм импорта (ТЗ починки импорта, Т-7).
 *
 * Список кодов один, а карты две: тексты «пустого файла» у страниц разные
 * (валидные строки против строк-операций). С этапа 3 обе страницы принимают
 * и `.xls`, и `.xlsx`.
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
  'format_mismatch',
  'sheets_not_recognized',
  'columns_not_recognized',
  'company_required',
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
  // Т-14: содержимое — не книга Excel (например .mxl или PDF под чужим именем).
  format_mismatch:
    'Это не похоже на файл Excel. Проверьте, что выгружали из 1С именно «Лист Excel 2007-…(xlsx)», а не .mxl или PDF.',
  // Т-11/Т-12: подробности — в блоке «Что увидела система в файле» под формой.
  sheets_not_recognized:
    'Не распознан ни один лист. Ниже показано, какие листы есть в файле и какие ожидаются.',
  columns_not_recognized:
    'В файле не хватает обязательных колонок — их список в блоке «Что увидела система в файле».',
  network_or_server: `Сервер не принял файл. Проверьте размер (до ${IMPORT_MAX_FILE_MB} МБ) и попробуйте ещё раз. Если файл заведомо меньше — повторите через минуту.`,
  // Т-41: admin без выбранной компании — новые организации некуда привязывать.
  company_required:
    'Выберите компанию для новых организаций — в системе их несколько, и без выбора импорт не знает, куда привязать новых контрагентов.',
} as const;

export const XLSX_IMPORT_ERRORS: Record<ImportErrorCode, string> = {
  ...SHARED,
  invalid_file: `Выберите файл .xls или .xlsx (не более ${IMPORT_MAX_FILE_MB} МБ)`,
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
