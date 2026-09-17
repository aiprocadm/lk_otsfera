import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccessSettingsSection } from '@/lib/auth/settingsAccess';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { prisma } from '@/lib/db/prisma';
import { readFile } from '@/lib/api/multipart';
import { replaceMaterialFile } from '@/lib/services/partnerMaterials/hub';
import { PARTNER_MATERIAL_HTTP_STATUS as STATUS } from '@/lib/services/partnerMaterials/shared';

/**
 * `POST /api/partner-materials/[id]/file` — замена файла материала (`У-237`):
 * новая версия уходит на проверку, прежняя скрывается у партнёра. Гарды те же,
 * что у создания.
 */
const SECTION = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.partnerMaterials')!;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessSettingsSection(session, SECTION)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const file = await readFile(form, 'file', { detect: 'duck', skipEmpty: true });
  if (!file) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const res = await replaceMaterialFile(prisma, session, id, {
    name: file.name,
    mimeType: file.type,
    size: file.size,
    buffer: file.buffer,
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.error === 'validation' ? { messages: res.messages } : {}) },
      { status: STATUS[res.error] ?? 400 }
    );
  }
  return NextResponse.json({ ok: true, fileId: res.fileId });
}
