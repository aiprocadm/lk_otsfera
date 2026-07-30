import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getObjectStorage } from '@/lib/storage';
import { validateMagicBytes } from '@/lib/storage/mimeValidator';
import { maxFileSizeBytes, ALLOWED_MIME_TYPES } from '@/lib/config/upload';
import { recordAudit } from '@/lib/auth/audit';
import { ingestInboundMessage } from './ingest';
import { log } from '@/lib/logging';

/**
 * Этап 9 (ФТ-11.1, PR-1) — «Задать вопрос» из кабинета партнёра/организации.
 * Пишется в общий поток обращений (`InboundMessage`, канал `cabinet`) через
 * существующий `ingestInboundMessage` — отдельного хранилища у поддержки нет.
 *
 * Статус намеренно `unresolved`, хотя отправитель известен: критерий Intake
 * (`intakeInboundWhere`) — именно неразобранные, а ФТ-11.1 требует, чтобы
 * вопрос попал во «Входящие в работу». Данные отправителя при этом
 * заполняются сразу (resolvedUserId / resolvedOrgId / companyId), поэтому
 * сотрудник видит, от кого письмо, и берёт его в работу существующими
 * действиями (claim / «Создать лид» / «Задача»).
 *
 * Клиенту возвращается короткий код обращения (решение §9-3 спеки): сквозной
 * нумерации у обращений нет, отдельный счётчик ради подтверждения не заводим.
 */

export type CabinetQuestionInput = {
  subject: string;
  body: string;
  file?: { name: string; type: string; size: number; buffer: Buffer } | null;
};

export type CabinetQuestionResult =
  | { ok: true; id: string; code: string }
  | {
      ok: false;
      error: 'forbidden' | 'validation' | 'too_large' | 'invalid_mime' | 'storage';
      messages?: string[];
    };

const MAX_SUBJECT = 200;
const MAX_BODY = 5000;

/** Короткий человекочитаемый код обращения из его id: «ОБР-3F7A2C». */
export function questionCode(id: string): string {
  return `ОБР-${id.slice(-6).toUpperCase()}`;
}

function sanitizeFilename(name: string): string {
  // Причина ignore ниже: `split` всегда возвращает минимум один элемент, поэтому
  // `pop()` не может дать undefined. `?? 'file'` оставлен только ради типа (TS
  // выводит `string | undefined`) — ветка структурно недостижима.
  /* v8 ignore next */
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120) || 'file';
}

/** Активная организация клиентской сессии (у партнёра организации нет). */
function activeOrgId(session: SessionPayload): string | null {
  if (session.role !== 'organization') return null;
  const memberships = session.organizationMemberships ?? [];
  const active = memberships.find((m) => m.isActive && m.organizationId === session.organizationId);
  return (active ?? memberships.find((m) => m.isActive))?.organizationId ?? session.organizationId ?? null;
}

export async function submitCabinetQuestion(
  prisma: PrismaClient,
  session: SessionPayload,
  input: CabinetQuestionInput
): Promise<CabinetQuestionResult> {
  if (session.role !== 'partner' && session.role !== 'organization') {
    return { ok: false, error: 'forbidden' };
  }

  const subject = input.subject?.trim() ?? '';
  const body = input.body?.trim() ?? '';
  const messages: string[] = [];
  if (!subject) messages.push('Укажите тему обращения');
  if (subject.length > MAX_SUBJECT) messages.push(`Тема — не длиннее ${MAX_SUBJECT} символов`);
  if (!body) messages.push('Опишите вопрос');
  if (body.length > MAX_BODY) messages.push(`Текст — не длиннее ${MAX_BODY} символов`);
  if (messages.length > 0) return { ok: false, error: 'validation', messages };

  // Вложение (одно — модель InboundMessage держит ровно одно): те же лимиты и
  // magic-bytes, что у вложений заявок; скан ставит ingest.
  let attachment: { path: string; name: string; mime: string } | null = null;
  if (input.file) {
    if (input.file.size > maxFileSizeBytes()) return { ok: false, error: 'too_large' };
    if (!ALLOWED_MIME_TYPES.has(input.file.type)) return { ok: false, error: 'invalid_mime' };
    if (!validateMagicBytes(input.file.type, input.file.buffer).ok) return { ok: false, error: 'invalid_mime' };

    const safeName = sanitizeFilename(input.file.name);
    const path = `support/${session.sub}/${randomUUID()}-${safeName}`;
    try {
      await getObjectStorage().upload(path, input.file.buffer, { contentType: input.file.type });
    } catch (err) {
      log.error('[inbound/cabinetQuestion] upload failed', { userId: session.sub, error: (err as Error).message });
      return { ok: false, error: 'storage' };
    }
    attachment = { path, name: safeName, mime: input.file.type };
  }

  const orgId = activeOrgId(session);
  const companyId = orgId
    ? (await prisma.organization.findUnique({ where: { id: orgId }, select: { companyId: true } }))?.companyId ?? null
    : null;

  const ingested = await ingestInboundMessage(prisma, {
    channel: 'cabinet',
    externalId: `cabinet:${randomUUID()}`,
    senderRef: session.email ?? session.sub,
    senderDisplay: session.name ?? null,
    subject,
    body,
    attachmentPath: attachment?.path,
    attachmentName: attachment?.name,
    attachmentMime: attachment?.mime,
    // Отправитель известен из сессии — resolve по каналу не нужен.
    sender: {
      userId: session.sub,
      organizationId: orgId,
      companyId
    }
  });
  if (!ingested.ok) return { ok: false, error: 'storage' };

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'cabinet_question_submitted',
    entity: 'inbound_message',
    entityId: ingested.id,
    after: { hasAttachment: attachment !== null, organizationId: orgId }
  });

  return { ok: true, id: ingested.id, code: questionCode(ingested.id) };
}
