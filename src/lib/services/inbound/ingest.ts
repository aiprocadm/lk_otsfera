import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveInboundSender } from './resolve';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

export type InboundDto = {
  channel: 'telegram' | 'max' | 'whatsapp' | 'email';
  externalId: string;
  senderRef: string;
  senderDisplay?: string;
  subject?: string;
  body: string;
  attachmentPath?: string;
  attachmentName?: string;
  attachmentMime?: string;
};
export type IngestResult =
  | { ok: true; id: string; deduped: boolean }
  // 'storage' reserved for the upcoming attachment-upload step (S3) — do not prune as dead.
  | { ok: false; error: 'storage' };

export async function ingestInboundMessage(prisma: PrismaClient, dto: InboundDto): Promise<IngestResult> {
  const existing = await prisma.inboundMessage.findUnique({ where: { externalId: dto.externalId }, select: { id: true } });
  if (existing) {
    await writeSyncLog({ entity: 'inbound', externalId: dto.externalId, direction: 'inbound', operation: 'skip', status: 'success' }, prisma);
    return { ok: true, id: existing.id, deduped: true };
  }

  const resolved = await resolveInboundSender(prisma, {
    channel: dto.channel,
    chatId: dto.channel === 'telegram' || dto.channel === 'max' ? dto.senderRef : undefined,
    phone: dto.channel === 'whatsapp' ? dto.senderRef : undefined,
    email: dto.channel === 'email' ? dto.senderRef : undefined,
  });

  let row: { id: string };
  try {
    row = await prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        senderRef: dto.senderRef,
        senderDisplay: dto.senderDisplay ?? null,
        subject: dto.subject ?? null,
        body: dto.body,
        attachmentPath: dto.attachmentPath ?? null,
        attachmentName: dto.attachmentName ?? null,
        attachmentMime: dto.attachmentMime ?? null,
        scanStatus: dto.attachmentPath ? 'pending' : 'none',
        ...(resolved.matchType === 'exact'
          ? { resolvedOrgId: resolved.orgId, resolvedUserId: resolved.userId, companyId: resolved.companyId, status: 'bound', boundAt: new Date() }
          : { status: 'unresolved' }),
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.inboundMessage.findUnique({ where: { externalId: dto.externalId }, select: { id: true } });
      await writeSyncLog({ entity: 'inbound', externalId: dto.externalId, direction: 'inbound', operation: 'skip', status: 'success' }, prisma);
      return { ok: true, id: raced?.id ?? '', deduped: true };
    }
    throw err;
  }

  await writeSyncLog({
    entity: 'inbound', externalId: dto.externalId, direction: 'inbound', operation: 'create',
    status: resolved.matchType === 'exact' ? 'success' : 'warn',
    errorMessage: resolved.matchType === 'exact' ? undefined : 'unresolved',
  }, prisma);

  // Best-effort: enqueue ClamAV scan for the attachment. Failure leaves
  // scanStatus='pending', where the backfill sweep will pick it up later
  // (CLAUDE.md §3 — queue enqueue is logged and swallowed, never blocks ingest).
  if (dto.attachmentPath) {
    try {
      const payload: ScanDocumentPayload = { kind: 'inbound_attachment', id: row.id };
      await getQueue('docs.scanDocument').add('scan', payload);
    } catch (err) {
      log.warn('[inbound/ingest] enqueue scan failed', {
        inboundMessageId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, id: row.id, deduped: false };
}
