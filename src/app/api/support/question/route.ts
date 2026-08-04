import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { formFields, readFile, readMultipart } from '@/lib/api/multipart';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitCabinetQuestion } from '@/lib/services/inbound/cabinetQuestion';

/**
 * Этап 9 (ФТ-11.1) — POST /api/support/question: вопрос из кабинета клиента.
 * Тонкий роут (§3 CLAUDE.md): только разбор multipart и маппинг Result→HTTP.
 */

// Поле не строка (или его нет) → пустая строка: валидацию делает сервис,
// роут обязан передать '' , а не undefined.
const FIELDS = z.object({
  subject: z.string().catch(''),
  body: z.string().catch(''),
});

const STATUS: Record<string, number> = {
  forbidden: 403,
  validation: 400,
  too_large: 413,
  invalid_mime: 415,
  storage: 502,
};

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('cabinet_questions');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await readMultipart(req);
  if (!form) return NextResponse.json({ error: 'validation' }, { status: 400 });

  const { subject, body } = formFields(form, FIELDS);
  // Пустой файл (браузер прислал input без выбранного файла) = файла нет.
  const file = await readFile(form, 'file', { detect: 'duck', skipEmpty: true });

  const res = await submitCabinetQuestion(prisma, session, { subject, body, file });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, messages: res.messages },
      { status: STATUS[res.error] ?? 400 }
    );
  }
  return NextResponse.json({ id: res.id, code: res.code }, { status: 201 });
}
