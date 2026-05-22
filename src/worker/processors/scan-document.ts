import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { Socket } from 'node:net';
import { prisma } from '@/lib/db/prisma';
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import type { ScanDocumentPayload, ScanDocumentTarget } from '@/lib/jobs/types';

export type ScanStatus = 'clean' | 'infected' | 'error';

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
    socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '').trim()));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`ClamAV socket timeout after ${timeoutMs}ms`));
    });
    socket.once('error', (err) => reject(err));

    socket.connect(port, host);
  });
}

async function defaultDownload(path: string): Promise<Buffer> {
  const storage = getServerClient().storage.from(documentBucket);
  const { data, error } = await storage.download(path);
  if (error || !data) throw new Error(`STORAGE_DOWNLOAD: ${error?.message ?? 'no data'}`);
  return Buffer.from(await data.arrayBuffer());
}

export const defaultScanDeps: ScanDeps = {
  scan: clamAvInstream,
  download: defaultDownload,
};

async function loadTarget(
  db: PrismaClient,
  kind: ScanDocumentTarget,
  id: string,
): Promise<{ id: string; path: string } | null> {
  if (kind === 'document') {
    return db.document.findUnique({ where: { id }, select: { id: true, path: true } });
  }
  return db.leadAttachment.findUnique({ where: { id }, select: { id: true, path: true } });
}

async function persistResult(
  db: PrismaClient,
  kind: ScanDocumentTarget,
  id: string,
  scanStatus: ScanStatus,
  scanReason: string | null,
): Promise<void> {
  const data = { scanStatus, scanReason, scannedAt: new Date() };
  if (kind === 'document') {
    await db.document.update({ where: { id }, data });
  } else {
    await db.leadAttachment.update({ where: { id }, data });
  }
}

type ParsedScanResponse =
  | { type: 'clean' }
  | { type: 'infected'; virus: string }
  | { type: 'error'; reason: string };

function parseClamAvResponse(response: string): ParsedScanResponse {
  if (/: OK\b/.test(response)) return { type: 'clean' };
  const found = /: (.+) FOUND\b/.exec(response);
  if (found) return { type: 'infected', virus: found[1].trim() };
  return { type: 'error', reason: `Unexpected ClamAV response: ${response.slice(0, 200) || '(empty)'}` };
}

export async function scanDocumentProcessor(
  job: Job<ScanDocumentPayload>,
  db: PrismaClient = prisma,
  deps: ScanDeps = defaultScanDeps,
): Promise<ScanDocumentResult> {
  const { kind, id } = job.data;
  console.log('[worker] scan-document started', { id: job.id, kind, targetId: id });

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
      db,
    );
    return { kind, id, scanStatus: 'clean', scanReason: null };
  }

  let payload: Buffer;
  try {
    payload = await deps.download(target.path);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await persistResult(db, kind, id, 'error', reason);
    await writeSyncLog(
      {
        entity: 'scan',
        externalId: id,
        direction: 'inbound',
        operation: 'check',
        status: 'error',
        errorMessage: reason,
      },
      db,
    );
    return { kind, id, scanStatus: 'error', scanReason: reason };
  }

  let response: string;
  try {
    response = await deps.scan(host, port, payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await persistResult(db, kind, id, 'clean', null);
    await writeSyncLog(
      {
        entity: 'scan',
        externalId: id,
        direction: 'inbound',
        operation: 'check',
        status: 'warn',
        errorMessage: `ClamAV unreachable, marking clean: ${reason}`,
      },
      db,
    );
    return { kind, id, scanStatus: 'clean', scanReason: null };
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
    db,
  );
  return { kind, id, scanStatus: 'error', scanReason: parsed.reason };
}
