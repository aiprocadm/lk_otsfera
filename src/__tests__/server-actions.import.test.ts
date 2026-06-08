import { describe, it, expect, vi, beforeEach } from 'vitest';

const { previewImport, commitImport } = vi.hoisted(() => ({
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));
const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));

vi.mock('@/lib/services/import', () => ({ previewImport, commitImport }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { previewImportAction, commitImportAction } from '@/server-actions/import';

const session = { sub: 'u1', role: 'manager', email: 'mgr@x.ru', name: 'M' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(session);
});

function fd(entries: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const xlsxFile = () => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'data.xlsx', {
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

describe('previewImportAction', () => {
  it('returns invalid_file when no File in FormData', async () => {
    const result = await previewImportAction(fd({ file: 'not-a-file' }));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('returns invalid_file when file key is missing', async () => {
    const result = await previewImportAction(fd({}));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('delegates to previewImport and returns its result', async () => {
    const plan = {
      counts: { orgsCreated: 1, orgsUpdated: 0, orgsStandalone: 0, ordersUpserted: 2, paymentsUpserted: 3 },
      skipped: { orgs: [], orders: [], payments: [] },
      quarantine: [],
    };
    previewImport.mockResolvedValue({ ok: true, plan });
    const result = await previewImportAction(fd({ file: xlsxFile() }));
    expect(requireSession).toHaveBeenCalled();
    expect(previewImport).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({ fileBuffer: expect.any(Buffer) }),
    );
    expect(result).toEqual({ ok: true, plan });
  });

  it('passes through service error results', async () => {
    previewImport.mockResolvedValue({ ok: false, error: 'empty' });
    const result = await previewImportAction(fd({ file: xlsxFile() }));
    expect(result).toEqual({ ok: false, error: 'empty' });
  });
});

describe('commitImportAction', () => {
  it('returns invalid_file when no File in FormData', async () => {
    const result = await commitImportAction(fd({}));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(commitImport).not.toHaveBeenCalled();
  });

  it('delegates to commitImport and returns its result', async () => {
    const applied = { orgsCreated: 1, orgsUpdated: 0, orgsStandalone: 0, ordersUpserted: 2, paymentsUpserted: 3 };
    commitImport.mockResolvedValue({ ok: true, applied, skipped: { orgs: [], orders: [], payments: [] } });
    const result = await commitImportAction(fd({ file: xlsxFile() }));
    expect(commitImport).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({ fileBuffer: expect.any(Buffer) }),
    );
    expect(result).toEqual({ ok: true, applied, skipped: { orgs: [], orders: [], payments: [] } });
  });
});
