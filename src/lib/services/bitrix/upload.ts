import { randomUUID } from 'node:crypto';
import type { FormFile } from '@/lib/api/multipart';
import { BITRIX_UPLOAD_MAX_FILES, IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';
import { bestEffort, log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import { inspectBitrixFile } from './adapter-file';
import type { BitrixFileDiagnostic } from './column-map';
import { BitrixSourceError } from './source';

/**
 * Приём выгрузок Битрикс24 (`У-189` file, `У-200`): до пяти файлов CSV/XLSX,
 * каждый не больше `IMPORT_MAX_FILE_BYTES`. Файл читается целиком ДО записи в
 * хранилище: битый файл или нераспознанная шапка не оставляют в S3 половину
 * пакета. Распознанные файлы ложатся под `bitrix-import/uploads/<uuid>/`, их
 * ключи форма пакета (PR-3) положит в `settings.fileKeys`; нераспознанный
 * файл возвращается с `key: null` и подсказкой, чего не хватило в шапке.
 * Содержимое файлов (ПДн контактов) в логи не пишется — только имена.
 */
type BitrixUploadedFileInfo = BitrixFileDiagnostic & { key: string | null };

type BitrixUploadError =
  'no_files' | 'too_many_files' | 'too_large' | 'invalid_mime' | 'file_unreadable' | 'storage';

export type BitrixUploadResult =
  | { ok: true; files: BitrixUploadedFileInfo[] }
  | { ok: false; error: BitrixUploadError; file?: string };

const BITRIX_UPLOAD_PREFIX = 'bitrix-import/uploads';

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Тип файла по расширению; `null` — расширение не из списка.
 *
 * Проверять `ext in CONTENT_TYPES` нельзя: `in` видит и цепочку прототипов,
 * поэтому имя `дамп.constructor` проходило бы allow-list, а в S3 уходил бы
 * `contentType` со значением функции `Object`. Собственные ключи — `hasOwn`.
 */
function contentTypeOf(name: string): string | null {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, ext) ? (CONTENT_TYPES[ext] as string) : null;
}

/** Имя в ключе S3: буквы любого алфавита, цифры, точка, дефис, подчёркивание; остальное — `_`. */
function safeName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .slice(-120);
}

export async function storeBitrixUploads(files: FormFile[]): Promise<BitrixUploadResult> {
  if (files.length === 0) return { ok: false, error: 'no_files' };
  if (files.length > BITRIX_UPLOAD_MAX_FILES) return { ok: false, error: 'too_many_files' };
  for (const f of files) {
    if (f.size > IMPORT_MAX_FILE_BYTES) return { ok: false, error: 'too_large', file: f.name };
    if (contentTypeOf(f.name) === null) {
      return { ok: false, error: 'invalid_mime', file: f.name };
    }
  }

  const inspected: Array<{
    file: FormFile;
    contentType: string;
    diagnostic: BitrixFileDiagnostic;
  }> = [];
  for (const file of files) {
    try {
      inspected.push({
        file,
        // Тип уже посчитан проверкой выше — второй раз не угадываем.
        contentType: contentTypeOf(file.name) as string,
        diagnostic: await inspectBitrixFile(file.buffer, file.name),
      });
    } catch (e) {
      if (e instanceof BitrixSourceError && e.code === 'file_unreadable') {
        return { ok: false, error: 'file_unreadable', file: file.name };
      }
      throw e;
    }
  }

  const storage = getObjectStorage();
  const folder = randomUUID();
  const uploaded: string[] = [];
  const out: BitrixUploadedFileInfo[] = [];
  for (const [i, { file, contentType, diagnostic }] of inspected.entries()) {
    if (!diagnostic.entity) {
      out.push({ ...diagnostic, key: null });
      continue;
    }
    const key = `${BITRIX_UPLOAD_PREFIX}/${folder}/${i + 1}-${safeName(file.name)}`;
    try {
      await storage.upload(key, file.buffer, { contentType });
    } catch (e) {
      log.error('[bitrix/upload] storage upload failed', {
        file: file.name,
        error: e instanceof Error ? e.message : String(e),
      });
      // Уже записанные файлы этого захода не нужны без остальных — подчищаем, не мешая ответу.
      if (uploaded.length > 0) {
        await storage.remove(uploaded).catch(bestEffort('[bitrix/upload] cleanup failed'));
      }
      return { ok: false, error: 'storage', file: file.name };
    }
    uploaded.push(key);
    out.push({ ...diagnostic, key });
  }
  return { ok: true, files: out };
}
