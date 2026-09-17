/** §11 ТЗ: максимальный размер пользовательского документа. */
export const DEFAULT_MAX_FILE_SIZE_MB = 200;

/** Server-side: env-override с валидацией; невалид/0/NaN → дефолт. */
export function resolveMaxFileSizeMb(): number {
  const raw = Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? DEFAULT_MAX_FILE_SIZE_MB);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_SIZE_MB;
}

export function maxFileSizeBytes(): number {
  return resolveMaxFileSizeMb() * 1024 * 1024;
}

/**
 * §13 ТЗ: единый allow-list форматов документа — тип и его расширения рядом.
 *
 * Раньше список типов лежал здесь, а список расширений — своей копией в
 * `api/documents/upload`. Копии разъехались: общий список принимал `.xls`,
 * а роут админ-панели молча его отвергал; `.zip`, наоборот, жил только в
 * роуте. Один и тот же файл получал разный ответ в зависимости от кабинета.
 * Теперь источник один (§12b), а канальные исключения объявляются явно.
 */
const DOCUMENT_FORMATS: ReadonlyArray<{ mime: string; extensions: readonly string[] }> = [
  { mime: 'application/pdf', extensions: ['.pdf'] },
  { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mime: 'image/png', extensions: ['.png'] },
  { mime: 'application/msword', extensions: ['.doc'] }, // legacy, §13
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
  },
  { mime: 'application/vnd.ms-excel', extensions: ['.xls'] }, // legacy, §13
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['.xlsx'],
  },
];

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set<string>(
  DOCUMENT_FORMATS.map((f) => f.mime)
);

/**
 * `У-237` (этап 6): материалы для партнёров принимают ещё презентации —
 * PowerPoint у документов заказа не нужен, у материалов для агентов это
 * основной формат. Список живёт здесь, рядом с общим: второй allow-list в
 * другом файле разошёлся бы с первым при первой же правке (страж
 * `config.upload-formats`).
 */
const PRESENTATION_FORMATS: ReadonlyArray<{ mime: string; extensions: readonly string[] }> = [
  {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['.pptx'],
  },
  { mime: 'application/vnd.ms-powerpoint', extensions: ['.ppt'] },
];

export const PARTNER_MATERIAL_MIME_TYPES: ReadonlySet<string> = new Set<string>(
  [...DOCUMENT_FORMATS, ...PRESENTATION_FORMATS].map((f) => f.mime)
);

/** Расширения тех же форматов — для ранней проверки имени файла. */
export const ALLOWED_EXTENSIONS: readonly string[] = DOCUMENT_FORMATS.flatMap((f) => f.extensions);
