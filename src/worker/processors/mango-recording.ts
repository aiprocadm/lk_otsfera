import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { getMangoAdapter } from '@/lib/telephony/mango';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { getObjectStorage } from '@/lib/storage';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

export type MangoRecordingPayload = {
  externalId: string;
  recordingId: string;
};

export type MangoRecordingResult =
  | { skipped: 'no_call' }
  | { skipped: 'no_recording' }
  | { stored: true };

export async function mangoRecordingProcessor(
  job: Job<MangoRecordingPayload>,
  db: PrismaClient = prisma,
): Promise<MangoRecordingResult> {
  const { externalId, recordingId } = job.data;

  // REST-адаптер читает креды Mango из кэша настроек интеграций — праймим,
  // чтобы значения из /admin/integrations доезжали до воркера без рестарта.
  await primeIntegrationSettingsCache(db);

  const call = await db.call.findUnique({
    where: { provider_externalId: { provider: 'mango', externalId } },
    select: { id: true },
  });
  if (!call) return { skipped: 'no_call' };

  const rec = await getMangoAdapter().fetchRecording(recordingId);
  if (!rec) return { skipped: 'no_recording' }; // recording service off / not available — valid, non-failing path

  const path = `calls/${externalId}/recording.mp3`;
  await getObjectStorage().upload(path, rec.buffer, { contentType: rec.contentType });

  await db.call.update({
    where: { id: call.id },
    data: { recordingId, recordingPath: path, recordingScanStatus: 'pending' },
  });

  const payload: ScanDocumentPayload = { kind: 'call_recording', id: call.id };
  await getQueue('docs.scanDocument').add('scan', payload).catch((err) => {
    log.warn('[mango-recording] enqueue scan failed', {
      callId: call.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { stored: true };
}
