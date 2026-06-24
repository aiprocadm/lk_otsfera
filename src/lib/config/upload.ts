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

/** §13 ТЗ: единый allow-list MIME для загрузки документов. */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword', // .doc (legacy, §13)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);
