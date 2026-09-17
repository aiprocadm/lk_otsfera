import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { prisma } from '@/lib/db/prisma';
import { formFields, readFile } from '@/lib/api/multipart';
import { createMaterial } from '@/lib/services/partnerMaterials/hub';
import {
  PARTNER_MATERIAL_HTTP_STATUS as STATUS,
  parseMaterialCategory,
} from '@/lib/services/partnerMaterials/shared';

/**
 * `POST /api/partner-materials` — новый материал для партнёров (`У-237`).
 * Файловый роут, а не server action (§11 CLAUDE.md — bodySizeLimit). Гарды:
 * право раздела хаба «Материалы для партнёров» + граница компании в сервисе.
 * Роут только читает форму и мапит код сервиса в статус.
 */
const SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.partnerMaterials')!;

const fields = z.object({
  companyId: z.string().catch(''),
  title: z.string().catch(''),
  description: z.string().catch(''),
  category: z.string().catch(''),
  externalUrl: z.string().catch(''),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const f = formFields(form, fields);
  const category = parseMaterialCategory(f.category);
  if (!f.companyId || !category) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const file = await readFile(form, 'file', { detect: 'duck', skipEmpty: true });

  const res = await createMaterial(
    prisma,
    session,
    f.companyId,
    { title: f.title, description: f.description, category, externalUrl: f.externalUrl },
    file ? { name: file.name, mimeType: file.type, size: file.size, buffer: file.buffer } : null
  );
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.error === 'validation' ? { messages: res.messages } : {}) },
      { status: STATUS[res.error] ?? 400 }
    );
  }
  return NextResponse.json({ ok: true, id: res.id });
}
