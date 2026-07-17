import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import type { ScanDeps } from '@/worker/processors/scan-document';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    download: vi.fn(),
    upload: vi.fn(),
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
  }),
}));

import { scanDocumentProcessor } from '@/worker/processors/scan-document';

type StubDb = ReturnType<typeof makeDb>;

function makeDb(
  opts: {
    documentPath?: string | null;
    attachmentPath?: string | null;
    inboundAttachmentPath?: string | null;
    callRecordingPath?: string | null;
    staffAttachmentPath?: string | null;
  } = {},
) {
  const documentUpdate = vi.fn().mockResolvedValue({});
  const attachmentUpdate = vi.fn().mockResolvedValue({});
  const inboundMessageUpdate = vi.fn().mockResolvedValue({});
  const callUpdate = vi.fn().mockResolvedValue({});
  const staffMessageUpdate = vi.fn().mockResolvedValue({});
  const syncLogCreate = vi.fn().mockResolvedValue({});
  return {
    document: {
      findUnique: vi.fn().mockResolvedValue(
        opts.documentPath === undefined
          ? { id: 'doc-1', path: 'orders/o1/file.pdf' }
          : opts.documentPath === null
            ? null
            : { id: 'doc-1', path: opts.documentPath },
      ),
      update: documentUpdate,
    },
    leadAttachment: {
      findUnique: vi.fn().mockResolvedValue(
        opts.attachmentPath === undefined
          ? { id: 'att-1', path: 'leads/l1/file.pdf' }
          : opts.attachmentPath === null
            ? null
            : { id: 'att-1', path: opts.attachmentPath },
      ),
      update: attachmentUpdate,
    },
    inboundMessage: {
      findUnique: vi.fn().mockResolvedValue(
        opts.inboundAttachmentPath === undefined
          ? { id: 'inbound-1', attachmentPath: 'inbound/msg-1/file.pdf' }
          : opts.inboundAttachmentPath === null
            ? null
            : { id: 'inbound-1', attachmentPath: opts.inboundAttachmentPath },
      ),
      update: inboundMessageUpdate,
    },
    call: {
      findUnique: vi.fn().mockResolvedValue(
        opts.callRecordingPath === undefined
          ? { id: 'call-1', recordingPath: 'calls/c1/recording.mp3' }
          : opts.callRecordingPath === null
            ? null
            : { id: 'call-1', recordingPath: opts.callRecordingPath },
      ),
      update: callUpdate,
    },
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue(
        opts.staffAttachmentPath === undefined
          ? { id: 'staff-msg-1', attachmentPath: 'staff-chat/conv-1/file.pdf' }
          : opts.staffAttachmentPath === null
            ? null
            : { id: 'staff-msg-1', attachmentPath: opts.staffAttachmentPath },
      ),
      update: staffMessageUpdate,
    },
    syncLog: { create: syncLogCreate },
  } as any;
}

function makeJob(data: ScanDocumentPayload, id = 'job-1'): Job<ScanDocumentPayload> {
  return { id, data } as Job<ScanDocumentPayload>;
}

function makeDeps(over: Partial<ScanDeps> = {}): ScanDeps {
  return {
    scan: over.scan ?? vi.fn().mockResolvedValue('stream: OK'),
    download: over.download ?? vi.fn().mockResolvedValue(Buffer.from('payload')),
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CLAMAV_HOST;
  delete process.env.CLAMAV_PORT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('scanDocumentProcessor', () => {
  it('marks document clean and logs warn when CLAMAV_HOST is not configured', async () => {
    const db: StubDb = makeDb();
    const deps = makeDeps();

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result).toEqual({ kind: 'document', id: 'doc-1', scanStatus: 'clean', scanReason: null });
    expect(deps.scan).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
    expect(db.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: expect.objectContaining({ scanStatus: 'clean', scanReason: null }),
    });
    expect(db.syncLog.create).toHaveBeenCalledTimes(1);
    expect(db.syncLog.create.mock.calls[0][0].data).toMatchObject({
      entity: 'scan',
      status: 'warn',
      errorMessage: expect.stringContaining('CLAMAV_HOST not configured'),
    });
  });

  it('marks document clean when ClamAV responds "stream: OK"', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: OK') });

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result.scanStatus).toBe('clean');
    expect(deps.scan).toHaveBeenCalledWith('clamav.local', 3310, expect.any(Buffer));
    expect(db.syncLog.create).not.toHaveBeenCalled();
  });

  it('marks document infected and captures virus name from "FOUND" response', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({
      scan: vi.fn().mockResolvedValue('stream: Win.Test.EICAR_HDB-1 FOUND'),
    });

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result).toEqual({
      kind: 'document',
      id: 'doc-1',
      scanStatus: 'infected',
      scanReason: 'Win.Test.EICAR_HDB-1',
    });
    expect(db.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: expect.objectContaining({ scanStatus: 'infected', scanReason: 'Win.Test.EICAR_HDB-1' }),
    });
    expect(db.syncLog.create).not.toHaveBeenCalled();
  });

  it('re-throws when ClamAV is unreachable (job retries) and never marks the file clean', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({
      scan: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps),
    ).rejects.toThrow(/ECONNREFUSED/);

    // Must NOT persist any status (especially not 'clean') on a scanner outage.
    expect(db.document.update).not.toHaveBeenCalled();
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'scan',
        status: 'error',
        errorMessage: expect.stringContaining('ECONNREFUSED'),
      }),
    });
  });

  it('marks scan as error when ClamAV returns an unexpected response', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('something weird') });

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result.scanStatus).toBe('error');
    expect(result.scanReason).toContain('Unexpected ClamAV response');
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: 'scan', status: 'error' }),
    });
  });

  it('re-throws when storage download fails (job retries) and leaves the row pending', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({
      download: vi.fn().mockRejectedValue(new Error('STORAGE_DOWNLOAD: timeout')),
      scan: vi.fn(),
    });

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps),
    ).rejects.toThrow(/STORAGE_DOWNLOAD/);

    // Must NOT persist a terminal 'error' status: the backfill sweep only
    // re-enqueues 'pending' rows, so a transient storage failure marked as
    // 'error' would strand the document unscanned forever.
    expect(db.document.update).not.toHaveBeenCalled();
    expect(deps.scan).not.toHaveBeenCalled();
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'scan',
        status: 'error',
        errorMessage: expect.stringContaining('STORAGE_DOWNLOAD'),
      }),
    });
  });

  it('updates LeadAttachment row when kind=leadAttachment', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: Eicar-Test-Signature FOUND') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'leadAttachment', id: 'att-1' }),
      db,
      deps,
    );

    expect(result.scanStatus).toBe('infected');
    expect(db.leadAttachment.update).toHaveBeenCalledWith({
      where: { id: 'att-1' },
      data: expect.objectContaining({ scanStatus: 'infected', scanReason: 'Eicar-Test-Signature' }),
    });
    expect(db.document.update).not.toHaveBeenCalled();
  });

  it('updates InboundMessage row when kind=inbound_attachment (no scannedAt column)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: OK') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'inbound_attachment', id: 'inbound-1' }),
      db,
      deps,
    );

    expect(result).toEqual({
      kind: 'inbound_attachment',
      id: 'inbound-1',
      scanStatus: 'clean',
      scanReason: null,
    });
    expect(db.inboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'inbound-1' },
      data: { scanStatus: 'clean', scanReason: null },
    });
    expect(db.document.update).not.toHaveBeenCalled();
    expect(db.leadAttachment.update).not.toHaveBeenCalled();
  });

  it('marks InboundMessage infected and captures virus name from "FOUND" response', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: Eicar-Test-Signature FOUND') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'inbound_attachment', id: 'inbound-1' }),
      db,
      deps,
    );

    expect(result.scanStatus).toBe('infected');
    expect(db.inboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'inbound-1' },
      data: { scanStatus: 'infected', scanReason: 'Eicar-Test-Signature' },
    });
  });

  it('updates Call.recordingScanStatus only when kind=call_recording (no scanReason/scannedAt columns)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: OK') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'call_recording', id: 'call-1' }),
      db,
      deps,
    );

    expect(result).toEqual({
      kind: 'call_recording',
      id: 'call-1',
      scanStatus: 'clean',
      scanReason: null,
    });
    expect(db.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { recordingScanStatus: 'clean' },
    });
    expect(db.document.update).not.toHaveBeenCalled();
    expect(db.leadAttachment.update).not.toHaveBeenCalled();
    expect(db.inboundMessage.update).not.toHaveBeenCalled();
  });

  it('marks Call recording infected and captures virus name from "FOUND" response', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: Eicar-Test-Signature FOUND') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'call_recording', id: 'call-1' }),
      db,
      deps,
    );

    expect(result.scanStatus).toBe('infected');
    expect(db.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data: { recordingScanStatus: 'infected' },
    });
  });

  it('throws NOT_FOUND when the Call has no recordingPath', async () => {
    const db = makeDb({ callRecordingPath: null });
    const deps = makeDeps();

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'call_recording', id: 'call-1' }), db, deps),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it('updates StaffMessage row when kind=staff_attachment (no scanReason/scannedAt columns)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: OK') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'staff_attachment', id: 'staff-msg-1' }),
      db,
      deps,
    );

    expect(result).toEqual({
      kind: 'staff_attachment',
      id: 'staff-msg-1',
      scanStatus: 'clean',
      scanReason: null,
    });
    expect(db.staffMessage.update).toHaveBeenCalledWith({
      where: { id: 'staff-msg-1' },
      data: { scanStatus: 'clean' },
    });
    expect(db.document.update).not.toHaveBeenCalled();
    expect(db.leadAttachment.update).not.toHaveBeenCalled();
    expect(db.inboundMessage.update).not.toHaveBeenCalled();
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it('marks StaffMessage infected and captures virus name from "FOUND" response', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('stream: Eicar-Test-Signature FOUND') });

    const result = await scanDocumentProcessor(
      makeJob({ kind: 'staff_attachment', id: 'staff-msg-1' }),
      db,
      deps,
    );

    expect(result.scanStatus).toBe('infected');
    expect(db.staffMessage.update).toHaveBeenCalledWith({
      where: { id: 'staff-msg-1' },
      data: { scanStatus: 'infected' },
    });
  });

  it('throws NOT_FOUND when the StaffMessage has no attachmentPath', async () => {
    const db = makeDb({ staffAttachmentPath: null });
    const deps = makeDeps();

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'staff_attachment', id: 'staff-msg-1' }), db, deps),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(db.staffMessage.update).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the InboundMessage has no attachmentPath', async () => {
    const db = makeDb({ inboundAttachmentPath: null });
    const deps = makeDeps();

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'inbound_attachment', id: 'inbound-1' }), db, deps),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(db.inboundMessage.update).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the target entity does not exist', async () => {
    const db = makeDb({ documentPath: null });
    const deps = makeDeps();

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(db.document.update).not.toHaveBeenCalled();
  });

  it('honours custom CLAMAV_PORT from env', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    process.env.CLAMAV_PORT = '3399';
    const db = makeDb();
    const scanSpy = vi.fn().mockResolvedValue('stream: OK');
    const deps = makeDeps({ scan: scanSpy });

    await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(scanSpy).toHaveBeenCalledWith('clamav.local', 3399, expect.any(Buffer));
  });

  it('uses "(empty)" placeholder when ClamAV returns an empty response (|| branch in parseClamAvResponse)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    // An empty response string → response.slice(0, 200) is '' (falsy) → || '(empty)' taken
    const deps = makeDeps({ scan: vi.fn().mockResolvedValue('') });

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result.scanStatus).toBe('error');
    expect(result.scanReason).toContain('(empty)');
  });

  it('converts non-Error download failure to string (String(err) branch in download catch)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    // Throw a plain string so `err instanceof Error` is false → String(err) branch
    const deps = makeDeps({
      download: vi.fn().mockRejectedValue('plain-string-error'),
    });

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps),
    ).rejects.toBe('plain-string-error');

    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorMessage: expect.stringContaining('plain-string-error'),
      }),
    });
  });

  it('converts non-Error scanner failure to string (String(err) branch in scan catch)', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    // Throw a plain string so `err instanceof Error` is false → String(err) branch
    const deps = makeDeps({
      scan: vi.fn().mockRejectedValue('scanner-plain-error'),
    });

    await expect(
      scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps),
    ).rejects.toBe('scanner-plain-error');

    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorMessage: expect.stringContaining('scanner-plain-error'),
      }),
    });
  });
});
