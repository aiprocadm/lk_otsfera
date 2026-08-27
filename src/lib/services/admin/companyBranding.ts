import { randomUUID } from 'node:crypto';
import type { CompanyBrandingSlot, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { BRANDING_MAX_BYTES, BRANDING_MAX_FILE_MB } from '@/lib/config/branding';
import { VAT_RATES } from './catalogItems';

/**
 * Этап 5 ТЗ (`У-138`) — налоговые настройки, шаблон нумерации и оформление
 * (логотип · подпись · печать) компании-исполнителя.
 *
 * Граница как у реквизитов: админ — любая компания, руководитель — только
 * своя (сравнением). Изображения живут в S3 (`company/<id>/branding/…`),
 * проходят антивирус (`ScanDocumentTarget: 'company_branding'`); заражённый
 * или непроверенный файл никуда не отдаётся. Применяют всё это генераторы
 * документов этапа 6 — здесь только хранение и редактирование.
 */

const SLOT_LABELS: Record<CompanyBrandingSlot, string> = {
  logo: 'Логотип',
  signature: 'Подпись',
  stamp: 'Печать',
};

export { BRANDING_MAX_BYTES } from '@/lib/config/branding';

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type Validation = { ok: false; error: 'validation'; messages: string[] };

function guardCompany(session: SessionPayload, companyId: string): Forbidden | null {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  if (session.role === 'leader' && companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Налоги (`У-138`): ставка НДС по умолчанию + «цены включают НДС»
// ---------------------------------------------------------------------------

export async function setCompanyTaxSettings(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: { defaultVatRate: string | null; pricesIncludeVat: boolean }
): Promise<{ ok: true } | Forbidden | NotFound | Validation> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  let vatRate: string | null = null;
  if (input.defaultVatRate !== null) {
    const rate = Number(input.defaultVatRate);
    if (!VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) {
      return {
        ok: false,
        error: 'validation',
        messages: ['Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»'],
      };
    }
    vatRate = rate.toFixed(4);
  }
  const before = await prisma.company.findUnique({
    where: { id: companyId },
    select: { defaultVatRate: true, pricesIncludeVat: true },
  });
  if (!before) return { ok: false, error: 'not_found' };
  await prisma.company.update({
    where: { id: companyId },
    data: { defaultVatRate: vatRate, pricesIncludeVat: input.pricesIncludeVat },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'company_tax_settings_changed',
    entity: 'company',
    entityId: companyId,
    before: {
      defaultVatRate: before.defaultVatRate === null ? null : before.defaultVatRate.toFixed(4),
      pricesIncludeVat: before.pricesIncludeVat,
    },
    after: { defaultVatRate: vatRate, pricesIncludeVat: input.pricesIncludeVat },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Нумерация (`У-138`): префиксы по типам + обнуление по годам. Только
// хранение и валидация — применяет генератор номера этапа 6.
// ---------------------------------------------------------------------------

const numberingSchema = z.object({
  prefixes: z.object({
    invoice: z.string().trim().max(12).regex(/^[\p{L}\p{N}-]*$/u, 'буквы, цифры, дефис').optional(),
    act: z.string().trim().max(12).regex(/^[\p{L}\p{N}-]*$/u, 'буквы, цифры, дефис').optional(),
    contract: z.string().trim().max(12).regex(/^[\p{L}\p{N}-]*$/u, 'буквы, цифры, дефис').optional(),
    supplementary: z
      .string()
      .trim()
      .max(12)
      .regex(/^[\p{L}\p{N}-]*$/u, 'буквы, цифры, дефис')
      .optional(),
  }),
  resetYearly: z.boolean(),
});

export type DocumentNumbering = z.infer<typeof numberingSchema>;

/** Разбор сохранённого JSON: кривое содержимое = «настроек нет», не падение. */
export function parseDocumentNumbering(raw: unknown): DocumentNumbering | null {
  const parsed = numberingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function setCompanyDocumentNumbering(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: unknown
): Promise<{ ok: true } | Forbidden | NotFound | Validation> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const parsed = numberingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      messages: ['Префикс: до 12 символов — буквы, цифры, дефис.'],
    };
  }
  const before = await prisma.company.findUnique({
    where: { id: companyId },
    select: { documentNumbering: true },
  });
  if (!before) return { ok: false, error: 'not_found' };
  await prisma.company.update({
    where: { id: companyId },
    data: { documentNumbering: parsed.data },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'company_numbering_changed',
    entity: 'company',
    entityId: companyId,
    before: { documentNumbering: before.documentNumbering },
    after: { documentNumbering: parsed.data },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Оформление (`У-138`): логотип · подпись · печать
// ---------------------------------------------------------------------------

export type BrandingSlotView = {
  slot: CompanyBrandingSlot;
  label: string;
  scanStatus: string;
  /** Presigned для предпросмотра — только у clean-файла. */
  previewUrl: string | null;
  mime: string;
};

/** Канонические 8 байт PNG: короткая проверка пропускала полиглоты. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Опасные конструкции SVG. Ревью PR-3 вскрыло, что проверка «пробел перед
 * `on…=`» обходится записью `<svg/onload=…>` — разделителем годится любой
 * пробельный символ И слэш. Перечислены и остальные векторы: внешние сущности
 * (XXE), встроенный HTML через `foreignObject`, ссылки на скрипты, SMIL-
 * анимация атрибутов, `data:`-документы.
 */
const SVG_DANGEROUS: Array<{ re: RegExp; why: string }> = [
  // `NS` — необязательный префикс пространства имён: `<svg:script>` исполняется
  // так же, как `<script>`, а простой поиск `<script` его не видит (второй
  // заход ревью PR-3).
  { re: /<\s*(?:[a-z0-9_-]+:)?script/i, why: 'скрипт' },
  // Разделителем перед обработчиком годится и пробел, и слэш, и кавычка
  // (`<svg/onload=`, `<set attributeName="onload"`).
  { re: /[\s/"']on[a-z]+\s*=/i, why: 'обработчик события' },
  { re: /javascript\s*:/i, why: 'javascript-ссылка' },
  { re: /data\s*:\s*text\/html/i, why: 'встроенный HTML-документ' },
  { re: /<\s*(?:[a-z0-9_-]+:)?foreignObject/i, why: 'встроенный HTML' },
  { re: /<!\s*ENTITY/i, why: 'внешняя сущность (XXE)' },
  { re: /<!\s*DOCTYPE[^>]*\[/i, why: 'внутреннее подмножество DTD' },
  { re: /<\s*(?:[a-z0-9_-]+:)?(animate|set)\b/i, why: 'SMIL-анимация атрибутов' },
  {
    re: /<\s*(?:[a-z0-9_-]+:)?use\b[^>]*href\s*=\s*["']?\s*(?:https?:|\/\/)/i,
    why: 'внешняя ссылка',
  },
];

/**
 * Числовые и именованные сущности — способ спрятать `javascript:` от простого
 * поиска (`&#x6a;avascript:`). Декодируем перед проверкой: фильтр должен
 * видеть то же, что увидит парсер браузера.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(tab|newline|colon);?/gi, (_, name: string) => (name.toLowerCase() === 'colon' ? ':' : ' '));
}

/**
 * PNG — по канонической сигнатуре; SVG — с фильтром содержимого (спека §7-1).
 *
 * Фильтр — первая линия, но не единственная: presigned-ссылка отдаётся с
 * `Content-Disposition: attachment` (браузер не отрендерит SVG как документ,
 * а `<img>` заголовок игнорирует, поэтому предпросмотр цел), плюс антивирус.
 */
function validateImage(mime: string, buffer: Buffer): { ok: true } | { ok: false; message: string } {
  if (buffer.length > BRANDING_MAX_BYTES) {
    return {
      ok: false,
      message: `Файл больше ${BRANDING_MAX_FILE_MB} МБ — уменьшите изображение.`,
    };
  }
  if (mime === 'image/png') {
    const sig = PNG_SIGNATURE.every((b, i) => buffer[i] === b);
    return sig ? { ok: true } : { ok: false, message: 'Файл не похож на PNG.' };
  }
  if (mime === 'image/svg+xml') {
    const head = buffer.subarray(0, 512).toString('utf8').trimStart();
    if (!head.startsWith('<?xml') && !head.startsWith('<svg')) {
      return { ok: false, message: 'Файл не похож на SVG.' };
    }
    const text = decodeEntities(buffer.toString('utf8'));
    const hit = SVG_DANGEROUS.find(({ re }) => re.test(text));
    if (hit) {
      return { ok: false, message: `SVG отклонён: ${hit.why} внутри файла.` };
    }
    return { ok: true };
  }
  return { ok: false, message: 'Допустимы только PNG и SVG.' };
}

export async function uploadCompanyBrandingAsset(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  slot: CompanyBrandingSlot,
  file: { buffer: Buffer; mime: string }
): Promise<{ ok: true } | Forbidden | NotFound | Validation | { ok: false; error: 'storage' }> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const valid = validateImage(file.mime, file.buffer);
  if (!valid.ok) return { ok: false, error: 'validation', messages: [valid.message] };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return { ok: false, error: 'not_found' };

  const ext = file.mime === 'image/png' ? 'png' : 'svg';
  const path = `company/${companyId}/branding/${slot}-${randomUUID()}.${ext}`;
  try {
    await getObjectStorage().upload(path, file.buffer, { contentType: file.mime });
  } catch (e) {
    log.error('[companyBranding] upload failed', {
      companyId,
      slot,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: 'storage' };
  }

  const previous = await prisma.companyBrandingAsset.findUnique({
    where: { companyId_slot: { companyId, slot } },
    select: { path: true },
  });
  const asset = await prisma.companyBrandingAsset.upsert({
    where: { companyId_slot: { companyId, slot } },
    create: { companyId, slot, path, mime: file.mime },
    update: { path, mime: file.mime, scanStatus: 'pending', scanReason: null, scannedAt: null },
    select: { id: true },
  });

  // Старый файл больше никем не адресуем — убираем best-effort.
  if (previous) {
    try {
      await getObjectStorage().remove([previous.path]);
    } catch {
      log.warn('[companyBranding] stale object not removed', { path: previous.path });
    }
  }

  // Best-effort антивирус — как у документов: сбой очереди оставляет pending.
  try {
    const payload: ScanDocumentPayload = { kind: 'company_branding', id: asset.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (err) {
    log.warn('[companyBranding] enqueue scan failed', {
      assetId: asset.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'company_branding_uploaded',
    entity: 'company',
    entityId: companyId,
    after: { slot, mime: file.mime },
  });
  return { ok: true };
}

export async function deleteCompanyBrandingAsset(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  slot: CompanyBrandingSlot
): Promise<{ ok: true } | Forbidden | NotFound> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const existing = await prisma.companyBrandingAsset.findUnique({
    where: { companyId_slot: { companyId, slot } },
    select: { id: true, path: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  await prisma.companyBrandingAsset.delete({ where: { id: existing.id } });
  try {
    await getObjectStorage().remove([existing.path]);
  } catch {
    log.warn('[companyBranding] object not removed on delete', { path: existing.path });
  }
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'company_branding_removed',
    entity: 'company',
    entityId: companyId,
    after: { slot },
  });
  return { ok: true };
}

/** Слоты компании со статусами; presigned — только у clean (10 минут, §10). */
export async function listCompanyBranding(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string
): Promise<{ ok: true; slots: BrandingSlotView[] } | Forbidden> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const assets = await prisma.companyBrandingAsset.findMany({
    where: { companyId },
    select: { id: true, slot: true, path: true, mime: true, scanStatus: true },
  });

  // Спека §3.2: `infected` — слот очищается, событие аудита. Делаем это при
  // первом же чтении: держать заражённый файл в хранилище незачем, а человек
  // должен увидеть пустой слот с приглашением загрузить другой, а не вечную
  // красную плашку.
  const infected = assets.filter((a) => a.scanStatus === 'infected');
  for (const bad of infected) {
    await prisma.companyBrandingAsset.delete({ where: { id: bad.id } });
    try {
      await getObjectStorage().remove([bad.path]);
    } catch {
      log.warn('[companyBranding] infected object not removed', { path: bad.path });
    }
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'company_branding_removed',
      entity: 'company',
      entityId: companyId,
      after: { slot: bad.slot, reason: 'infected' },
    });
  }

  const slots: BrandingSlotView[] = [];
  for (const slot of Object.keys(SLOT_LABELS) as CompanyBrandingSlot[]) {
    const asset = assets.find((a) => a.slot === slot && a.scanStatus !== 'infected');
    if (!asset) continue;
    let previewUrl: string | null = null;
    if (asset.scanStatus === 'clean') {
      try {
        // `attachment` — вторая линия против SVG-скриптов: прямая навигация
        // по ссылке скачает файл, а не выполнит его. Для `<img>` заголовок
        // игнорируется, поэтому предпросмотр остаётся живым.
        previewUrl = await getObjectStorage().createSignedUrl(asset.path, 600, {
          download: `${slot}.${asset.mime === 'image/png' ? 'png' : 'svg'}`,
        });
      } catch {
        // Предпросмотр — не повод ронять страницу настроек.
        log.warn('[companyBranding] sign failed', { path: asset.path });
      }
    }
    slots.push({
      slot,
      label: SLOT_LABELS[slot],
      scanStatus: asset.scanStatus,
      previewUrl,
      mime: asset.mime,
    });
  }
  return { ok: true, slots };
}
