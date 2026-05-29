import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import type { ScanDeps } from '@/worker/processors/scan-document';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage/supabase', () => ({
  getServerClient: () => ({ storage: { from: () => ({ download: vi.fn() }) } }),
  documentBucket: 'documents',
}));

import { scanDocumentProcessor } from '@/worker/processors/scan-document';

type StubDb = ReturnType<typeof makeDb>;

function makeDb(opts: { documentPath?: string | null; attachmentPath?: string | null } = {}) {
  const documentUpdate = vi.fn().mockResolvedValue({});
  const attachmentUpdate = vi.fn().mockResolvedValue({});
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

  it('marks scan as error when storage download throws', async () => {
    process.env.CLAMAV_HOST = 'clamav.local';
    const db = makeDb();
    const deps = makeDeps({
      download: vi.fn().mockRejectedValue(new Error('STORAGE_DOWNLOAD: not found')),
      scan: vi.fn(),
    });

    const result = await scanDocumentProcessor(makeJob({ kind: 'document', id: 'doc-1' }), db, deps);

    expect(result.scanStatus).toBe('error');
    expect(result.scanReason).toContain('STORAGE_DOWNLOAD');
    expect(deps.scan).not.toHaveBeenCalled();
    expect(db.syncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: 'scan', status: 'error' }),
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
});
