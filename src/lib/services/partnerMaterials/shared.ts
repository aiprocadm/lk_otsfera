import { randomUUID } from 'node:crypto';
import type { PartnerMaterialCategory } from '@prisma/client';
import { ALLOWED_MIME_TYPES, maxFileSizeBytes } from '@/lib/config/upload';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

/**
 * Материалы для партнёров (этап 6 ТЗ 12.09.2026, `У-237`, решение `Р-Э6-3`):
 * общие справочники двух сервисов — хаба (издатель — компания) и кабинета
 * партнёра (читатель — партнёр с организациями этой компании).
 */
export const PARTNER_MATERIAL_CATEGORIES: PartnerMaterialCategory[] = [
  'price_list',
  'presentation',
  'template',
  'instruction',
  'other',
];

export const PARTNER_MATERIAL_CATEGORY_LABELS: Record<PartnerMaterialCategory, string> = {
  price_list: 'Прайс-листы',
  presentation: 'Презентации',
  template: 'Шаблоны',
  instruction: 'Инструкции',
  other: 'Прочее',
};

/** Метка «Новое» держится столько дней после публикации (пакет 06 §10). */
const NEW_MATERIAL_DAYS = 7;

/**
 * Форматы материалов: общий allow-list документов плюс презентации — у
 * документов заказа PowerPoint не нужен, у материалов для агентов это
 * основной формат. Свой список, а не правка общего: общий кормит роуты
 * документов клиентов, и лишний формат там появился бы молча.
 */
export const PARTNER_MATERIAL_MIME_TYPES: ReadonlySet<string> = new Set<string>([
  ...ALLOWED_MIME_TYPES,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);

export function parseMaterialCategory(
  raw: string | undefined
): PartnerMaterialCategory | undefined {
  return PARTNER_MATERIAL_CATEGORIES.find((c) => c === raw);
}

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
