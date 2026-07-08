import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

const { fetchRecording, uploadMock, addMock } = vi.hoisted(() => ({
  fetchRecording: vi.fn(),
  uploadMock: vi.fn().mockResolvedValue(undefined),
  addMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/telephony/mango', () => ({
  getMangoAdapter: () => ({ fetchRecording }),
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock }),
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: addMock }),
}));

import { mangoRecordingProcessor, type MangoRecordingPayload } from '@/worker/processors/mango-recording';

const prisma = new PrismaClient();
const STAMP = `mrp${Date.now()}`;

function makeJob(data: MangoRecordingPayload): Job<MangoRecordingPayload> {
  return { id: 'job-1', data } as Job<MangoRecordingPayload>;
}

async function cleanup() {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
}

beforeAll(cleanup);
afterEach(() => {
  vi.clearAllMocks();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('mangoRecordingProcessor', () => {
  it('stores the recording in S3, marks the Call pending, and enqueues the AV scan', async () => {
    const externalId = `${STAMP}:with-recording`;
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId,
        direction: 'inbound',
        callerNumber: '+79990001111',
        status: 'completed',
      },
    });

    const buffer = Buffer.from('fake-mp3-bytes');
    fetchRecording.mockResolvedValue({ buffer, contentType: 'audio/mpeg' });

    const result = await mangoRecordingProcessor(
      makeJob({ externalId, recordingId: 'rec-123' }),
      prisma,
    );

    expect(result).toEqual({ stored: true });
    expect(uploadMock).toHaveBeenCalledWith(
      `calls/${externalId}/recording.mp3`,
      buffer,
      { contentType: 'audio/mpeg' },
    );
    expect(addMock).toHaveBeenCalledWith('scan', { kind: 'call_recording', id: call.id });

    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.recordingPath).toBe(`calls/${externalId}/recording.mp3`);
    expect(row?.recordingScanStatus).toBe('pending');
    expect(row?.recordingId).toBe('rec-123');
  });

  it('a call without a recording is a valid, non-failing path: no upload, no enqueue, status stays "none"', async () => {
    const externalId = `${STAMP}:no-recording`;
    const call = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId,
        direction: 'inbound',
        callerNumber: '+79990002222',
        status: 'completed',
      },
    });

    fetchRecording.mockResolvedValue(null);

    const result = await mangoRecordingProcessor(
      makeJob({ externalId, recordingId: 'rec-missing' }),
      prisma,
    );

    expect(result).toEqual({ skipped: 'no_recording' });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();

    const row = await prisma.call.findUnique({ where: { id: call.id } });
    expect(row?.recordingScanStatus).toBe('none');
    expect(row?.recordingPath).toBeNull();
  });

  it('returns skipped:no_call when the Call row does not exist, without uploading', async () => {
    const externalId = `${STAMP}:missing-call`;

    const result = await mangoRecordingProcessor(
      makeJob({ externalId, recordingId: 'rec-999' }),
      prisma,
    );

    expect(result).toEqual({ skipped: 'no_call' });
    expect(fetchRecording).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });
});
