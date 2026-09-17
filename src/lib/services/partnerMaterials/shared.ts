import { randomUUID } from 'node:crypto';
import { PARTNER_MATERIAL_MIME_TYPES, maxFileSizeBytes } from '@/lib/config/upload';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

/**
 * Материалы для партнёров (этап 6 ТЗ 12.09.2026, `У-237`, решение `Р-Э6-3`):
 * серверные помощники двух сервисов — хаба (издатель — компания) и кабинета
 * партнёра (читатель — партнёр с организациями этой компании). Справочник
 * категорий — в `categories.ts`: его читают и клиентские компоненты.
 */
/** Метка «Новое» держится столько дней после публикации (пакет 06 §10). */
const NEW_MATERIAL_DAYS = 7;

export type MaterialFileInput = {
  name: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
};

/** Размер — как у документов (`DEFAULT_MAX_FILE_SIZE_MB`), формат — свой список, magic-bytes — где умеем. */
export function validateMaterialFile(
  file: MaterialFileInput
): { ok: true } | { ok: false; error: 'too_large' | 'invalid_mime' } {
  if (file.size > maxFileSizeBytes()) return { ok: false, error: 'too_large' };
  if (!PARTNER_MATERIAL_MIME_TYPES.has(file.mimeType)) return { ok: false, error: 'invalid_mime' };
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    const check = validateMagicBytes(file.mimeType, file.buffer);
    if (!check.ok) return { ok: false, error: 'invalid_mime' };
  }
  return { ok: true };
}

export function materialStoragePath(companyId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `company/${companyId}/partner-materials/${randomUUID()}-${safe}`;
}

export function isNewMaterial(publishedAt: Date | null, now: Date): boolean {
  if (!publishedAt) return false;
  return now.getTime() - publishedAt.getTime() <= NEW_MATERIAL_DAYS * 24 * 60 * 60 * 1000;
}

/** Код сервиса → HTTP-статус для файловых роутов хаба (§3: роут только мапит). */
export const PARTNER_MATERIAL_HTTP_STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  validation: 400,
  too_large: 413,
  invalid_mime: 415,
  storage: 502,
};

/** Внешняя ссылка вместо файла: только http(s), без мусора. */
export function isValidExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
