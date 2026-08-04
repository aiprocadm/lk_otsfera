/**
 * Единый разбор `multipart/form-data` для файловых роутов.
 *
 * До этого модуля каждый файловый роут разбирал форму сам, и разбор разошёлся
 * в трёх местах:
 *   - чтение тела: `req.formData().catch(() => null)` против `try/catch`;
 *   - опознание файла: `value instanceof File` против duck-check
 *     `'arrayBuffer' in value`, плюс отдельная ветка «пустой файл = его нет»;
 *   - строковые поля: `String(v ?? 'default')` против
 *     `typeof v === 'string' ? v : ''`.
 *
 * Помощники НЕ решают, какой код ошибки отдать — это остаётся за роутом
 * (коды и статусы у роутов разные и являются частью их публичного контракта).
 * Расхождения семантики вынесены в явные опции, а не «унифицированы» молча.
 */
import type { z } from 'zod';

/** Файл формы в виде, который принимают сервисы (буфер уже вычитан). */
export type FormFile = { name: string; type: string; size: number; buffer: Buffer };

export type FileEntryOptions = {
  /**
   * Как опознать файл среди значений формы:
   *  - `'instanceof'` (по умолчанию) — `value instanceof File`;
   *  - `'duck'` — любой объект с методом `arrayBuffer` (исторический вариант
   *    `/api/support/question`: переживает окружения, где `File` из тела
   *    запроса и глобальный `File` — разные реализации).
   */
  detect?: 'instanceof' | 'duck';
  /** `true` → файл нулевого размера считается отсутствующим (`null`). */
  skipEmpty?: boolean;
};

function isFileEntry(raw: FormDataEntryValue | null, detect: 'instanceof' | 'duck'): raw is File {
  if (raw === null) return false;
  return detect === 'duck' ? typeof raw === 'object' && 'arrayBuffer' in raw : raw instanceof File;
}

/**
 * Тело запроса как `FormData`; кривое/не-multipart тело → `null`.
 * Код и текст ответа выбирает роут (у разных роутов они разные).
 */
export async function readMultipart(req: Request): Promise<FormData | null> {
  return req.formData().catch(() => null);
}

/**
 * Файл формы БЕЗ вычитывания буфера — для роутов, которые проверяют размер/MIME
 * до того, как материализовать содержимое.
 */
export function readFileEntry(
  form: FormData,
  key: string,
  opts: FileEntryOptions = {}
): File | null {
  const raw = form.get(key);
  if (!isFileEntry(raw, opts.detect ?? 'instanceof')) return null;
  if (opts.skipEmpty === true && raw.size === 0) return null;
  return raw;
}

/** Файл формы вместе с вычитанным буфером; поля файла нет → `null`. */
export async function readFile(
  form: FormData,
  key: string,
  opts: FileEntryOptions = {}
): Promise<FormFile | null> {
  const file = readFileEntry(form, key, opts);
  if (file === null) return null;
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

/**
 * Строковые поля формы по Zod-схеме.
 *
 * КОНТРАКТ: схема обязана быть **тотальной** — каждое поле имеет `.default()`
 * (ключа нет) и/или `.catch()` / `z.coerce` (значение не строка, например File).
 * Так исторические коэрции сохраняются один-в-один:
 *   `String(form.get(k) ?? 'd')`               → `z.coerce.string().default('d')`
 *   `typeof v === 'string' ? v : ''`           → `z.string().catch('')`
 * Доменную валидацию сюда не переносить: 400-ветки роутов остаются в роутах
 * (см. §3 CLAUDE.md — схема проверяет только форму входа).
 *
 * При повторяющемся ключе берётся ПЕРВОЕ значение — как у `FormData#get`.
 */
export function formFields<S extends z.ZodTypeAny>(form: FormData, schema: S): z.infer<S> {
  const obj: Record<string, FormDataEntryValue> = {};
  form.forEach((value, key) => {
    if (!(key in obj)) obj[key] = value;
  });
  return schema.parse(obj);
}
