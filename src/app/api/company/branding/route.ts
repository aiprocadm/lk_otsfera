import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { prisma } from '@/lib/db/prisma';
import { formFields, readFile } from '@/lib/api/multipart';
import {
  BRANDING_MAX_BYTES,
  uploadCompanyBrandingAsset,
} from '@/lib/services/admin/companyBranding';

/**
 * Загрузка логотипа/подписи/печати компании (`У-138`).
 *
 * Файловый API-роут, а не server action (§11 CLAUDE.md). Гарды: право
 * раздела «Реквизиты исполнителя» (default-deny профиль режет и загрузку —
 * уроки PR-1/PR-2 этого этапа) + граница компании в сервисе. Формат и
 * содержимое (PNG magic-bytes / SVG без скриптов, до 1 МБ) проверяет сервис.
 */
const REQUISITES_SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.requisites')!;

// `catch` здесь был бы вреден: неизвестный слот молча писался бы в «Логотип»
// и затирал бы его (ревью PR-3). Кривое значение — отказ.
const fields = z.object({
  companyId: z.string().catch(''),
  slot: z.string().catch(''),
});

const SLOTS = ['logo', 'signature', 'stamp'] as const;
type Slot = (typeof SLOTS)[number];

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, REQUISITES_SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { companyId, slot } = formFields(form, fields);
  if (!companyId || !SLOTS.includes(slot as Slot)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const file = await readFile(form, 'file', { detect: 'duck', skipEmpty: true });
  if (!file) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (file.size > BRANDING_MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  const res = await uploadCompanyBrandingAsset(prisma, session, companyId, slot as Slot, {
    buffer: file.buffer,
    mime: file.type,
  });
  if (!res.ok) {
    const status =
      res.error === 'forbidden'
        ? 403
        : res.error === 'not_found'
          ? 404
          : res.error === 'storage'
            ? 502
            : 400;
    return NextResponse.json(
      { error: res.error, ...(res.error === 'validation' ? { messages: res.messages } : {}) },
      { status }
    );
  }
  return NextResponse.json({ ok: true });
}
