import { Socket } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { getObjectStorage } from '@/lib/storage';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import type { ScanDocumentPayload, ScanDocumentTarget } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

type ScanStatus = 'clean' | 'infected' | 'error';

export type ScanDocumentResult = {
  kind: ScanDocumentTarget;
  id: string;
  scanStatus: ScanStatus;
  scanReason: string | null;
};

export type ScanDeps = {
  scan: (host: string, port: number, payload: Buffer) => Promise<string>;
  download: (path: string) => Promise<Buffer>;
};

const INSTREAM_CHUNK_BYTES = 64 * 1024;

/* v8 ignore start -- production ClamAV TCP implementation; exercised in e2e only, not unit-testable without a live scanner */
function clamAvInstream(host: string, port: number, payload: Buffer): Promise<string> {
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? '30000');
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < payload.length; offset += INSTREAM_CHUNK_BYTES) {
        const chunk = payload.subarray(offset, offset + INSTREAM_CHUNK_BYTES);
        const sizeBuf = Buffer.alloc(4);
        sizeBuf.writeUInt32BE(chunk.length, 0);
        socket.write(sizeBuf);
        socket.write(chunk);
      }
      const eof = Buffer.alloc(4);
      eof.writeUInt32BE(0, 0);
      socket.write(eof);
    });

    socket.on('data', (data) => chunks.push(data));
    socket.once('end', () =>
      resolve(Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '').trim())
    );
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`ClamAV socket timeout after ${timeoutMs}ms`));
    });
    socket.once('error', (err) => reject(err));

    socket.connect(port, host);
  });
}
/* v8 ignore stop */

/* v8 ignore start -- production S3 storage download; exercised in e2e only, not unit-testable without live storage */
async function defaultDownload(path: string): Promise<Buffer> {
  return getObjectStorage().download(path);
}
/* v8 ignore stop */

const defaultScanDeps: ScanDeps = {
  scan: clamAvInstream,
  download: defaultDownload,
};

async function loadTarget(
  db: PrismaClient,
  kind: ScanDocumentTarget,
  id: string
): Promise<{ id: string; path: string } | null> {
  if (kind === 'document') {
    return db.document.findUnique({ where: { id }, select: { id: true, path: true } });
  }
  if (kind === 'inbound_attachment') {
    const row = await db.inboundMessage.findUnique({
      where: { id },
      select: { id: true, attachmentPath: true },
    });
    if (!row || !row.attachmentPath) return null;
    return { id: row.id, path: row.attachmentPath };
  }
  if (kind === 'call_recording') {
    const row = await db.call.findUnique({
      where: { id },
      select: { id: true, recordingPath: true },
    });
    if (!row || !row.recordingPath) return null;
    return { id: row.id, path: row.recordingPath };
  }
  if (kind === 'staff_attachment') {
    const row = await db.staffMessage.findUnique({
      where: { id },
      select: { id: true, attachmentPath: true },
    });
    if (!row || !row.attachmentPath) return null;
    return { id: row.id, path: row.attachmentPath };
  }
  if (kind === 'client_request_attachment') {
    return db.clientRequestAttachment.findUnique({
      where: { id },
      select: { id: true, path: true },
    });
  }
  return db.leadAttachment.findUnique({ where: { id }, select: { id: true, path: true } });
}

async function persistResult(
  db: PrismaClient,
  kind: ScanDocumentTarget,
  id: string,
  scanStatus: ScanStatus,
  scanReason: string | null
): Promise<void> {
  if (kind === 'document') {
    await db.document.update({
      where: { id },
      data: { scanStatus, scanReason, scannedAt: new Date() },
    });
  } else if (kind === 'inbound_attachment') {
    // InboundMessage has no `scannedAt` column (unlike Document) — do not add it here.
    await db.inboundMessage.update({ where: { id }, data: { scanStatus, scanReason } });
  } else if (kind === 'call_recording') {
    // Call has neither a scan-reason column nor `scannedAt` (unlike Document) —
    // only `recordingScanStatus` is persisted here.
    await db.call.update({ where: { id }, data: { recordingScanStatus: scanStatus } });
  } else if (kind === 'staff_attachment') {
    // StaffMessage has neither a scan-reason column nor `scannedAt` (unlike Document) —
    // only `scanStatus` is persisted here (reason stays in SyncLog, mirroring call_recording).
    await db.staffMessage.update({ where: { id }, data: { scanStatus } });
  } else if (kind === 'client_request_attachment') {
    // Этап 5: вложения заявок клиентов — полный набор колонок, как LeadAttachment.
    await db.clientRequestAttachment.update({
      where: { id },
      data: { scanStatus, scanReason, scannedAt: new Date() },
    });
  } else {
    await db.leadAttachment.update({
      where: { id },
      data: { scanStatus, scanReason, scannedAt: new Date() },
    });
  }
}

type ParsedScanResponse =
  { type: 'clean' } | { type: 'infected'; virus: string } | { type: 'error'; reason: string };

function parseClamAvResponse(response: string): ParsedScanResponse {
  if (/: OK\b/.test(response)) return { type: 'clean' };
  // Группа 1 не опциональна: если exec вернул матч, она всегда строка.
  const virus = /: (.+) FOUND\b/.exec(response)?.[1];
  if (virus !== undefined) return { type: 'infected', virus: virus.trim() };
  return {
    type: 'error',
    reason: `Unexpected ClamAV response: ${response.slice(0, 200) || '(empty)'}`,
  };
}

export async function scanDocumentProcessor(
  job: Job<ScanDocumentPayload>,
  db: PrismaClient = prisma,
  deps: ScanDeps = defaultScanDeps
): Promise<ScanDocumentResult> {
  const { kind, id } = job.data;
  log.info('[worker] scan-document started', { id: job.id, kind, targetId: id });

  const target = await loadTarget(db, kind, id);
  if (!target) throw new Error(`NOT_FOUND: ${kind} ${id}`);

  const host = process.env.CLAMAV_HOST?.trim();
  const port = Number(process.env.CLAMAV_PORT ?? '3310');

  if (!host) {
    await persistResult(db, kind, id, 'clean', null);
    await writeSyncLog(
      {
        entity: 'scan',
        externalId: id,
        direction: 'inbound',
        operation: 'check',
        status: 'warn',
        errorMessage: 'CLAMAV_HOST not configured; marking clean by default',
      },
      db
    );
    return { kind, id, scanStatus: 'clean', scanReason: null };
  }

  let payload: Buffer;
  try {
    payload = await deps.download(target.path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // SECURITY: mirror the scanner-unreachable branch below — do NOT persist a
    // terminal 'error' status on a download failure. The backfill sweep only
    // re-enqueues 'pending' rows, so persisting 'error' here would strand the
    // document unscanned (and still downloadable) forever after a transient
    // storage outage. Re-throw so BullMQ retries; the row stays 'pending' for
    // the backfill sweep if the outage outlives the retry budget.
    await writeSyncLog(
      {
        entity: 'scan',
        externalId: id,
        direction: 'inbound',
        operation: 'check',
        status: 'error',
        errorMessage: `Storage download failed: ${reason}`,
      },
      db
    );
    throw err;
  }

  let response: string;
  try {
    response = await deps.scan(host, port, payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // SECURITY: do NOT mark the document clean when the scanner is unreachable —
    // that would permanently whitelist an unscanned file. Re-throw so BullMQ
    // retries (attempts:5, exponential backoff); a persistent outage lands the
    // job in the DLQ and leaves the document `pending` for the backfill sweep to
    // rescan once ClamAV recovers. (The CLAMAV_HOST-unset branch above is the
    // only intentional clean-by-default path, for envs without a scanner.)
    await writeSyncLog(
      {
        entity: 'scan',
        externalId: id,
        direction: 'inbound',
        operation: 'check',
        status: 'error',
        errorMessage: `ClamAV unreachable: ${reason}`,
      },
      db
    );
    throw err;
  }

  const parsed = parseClamAvResponse(response);
  if (parsed.type === 'clean') {
    await persistResult(db, kind, id, 'clean', null);
    return { kind, id, scanStatus: 'clean', scanReason: null };
  }
  if (parsed.type === 'infected') {
    await persistResult(db, kind, id, 'infected', parsed.virus);
    return { kind, id, scanStatus: 'infected', scanReason: parsed.virus };
  }
  await persistResult(db, kind, id, 'error', parsed.reason);
  await writeSyncLog(
    {
      entity: 'scan',
      externalId: id,
      direction: 'inbound',
      operation: 'check',
      status: 'error',
      errorMessage: parsed.reason,
    },
    db
  );
  return { kind, id, scanStatus: 'error', scanReason: parsed.reason };
}
