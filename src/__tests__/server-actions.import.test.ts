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

const xlsxFile = (name = 'data.xlsx', size?: number) => {
  const content = new Uint8Array(size ?? 4).fill(0x50);
  content[0] = 0x50;
  content[1] = 0x4b;
  content[2] = 0x03;
  content[3] = 0x04;
  return new File([content], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('previewImportAction — file guard', () => {
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

  it('returns invalid_file for a .csv file (wrong extension)', async () => {
    const file = new File([new Uint8Array(4)], 'data.csv', { type: 'text/csv' });
    const result = await previewImportAction(fd({ file }));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('returns invalid_file for oversized file (>20MB)', async () => {
    // Create a File whose size property reports > 20MB
    const bigFile = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const result = await previewImportAction(fd({ file: bigFile }));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('delegates to previewImport and returns its result for a valid .xlsx', async () => {
    const report = {
      orders: {
        pulled: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        invalid: 0,
        failed: 0,
        skips: [],
        invalids: [],
        failures: [],
      },
      payments: {
        pulled: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        invalid: 0,
        failed: 0,
        skips: [],
        invalids: [],
        failures: [],
      },
    };
    previewImport.mockResolvedValue({ ok: true, report });
    const result = await previewImportAction(fd({ file: xlsxFile() }));
    expect(requireSession).toHaveBeenCalled();
    expect(previewImport).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({ fileBuffer: expect.any(Buffer) })
    );
    expect(result).toEqual({ ok: true, report });
  });

  it('passes through service error results', async () => {
    previewImport.mockResolvedValue({ ok: false, error: 'empty' });
    const result = await previewImportAction(fd({ file: xlsxFile() }));
    expect(result).toEqual({ ok: false, error: 'empty' });
  });

  it('accepts .XLSX with uppercase extension', async () => {
    const file = new File([new Uint8Array(4)], 'DATA.XLSX', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    previewImport.mockResolvedValue({ ok: false, error: 'empty' });
    const result = await previewImportAction(fd({ file }));
    // Should have called previewImport (not returned invalid_file)
    expect(previewImport).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'empty' });
  });
});

describe('commitImportAction — file guard', () => {
  it('returns invalid_file when no File in FormData', async () => {
    const result = await commitImportAction(fd({}));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(commitImport).not.toHaveBeenCalled();
  });

  it('returns invalid_file for a non-.xlsx file', async () => {
    const file = new File([new Uint8Array(4)], 'data.xls', { type: 'application/vnd.ms-excel' });
    const result = await commitImportAction(fd({ file }));
    expect(result).toEqual({ ok: false, error: 'invalid_file' });
    expect(commitImport).not.toHaveBeenCalled();
  });

  it('delegates to commitImport and returns its result', async () => {
    const report = {
      orders: {
        pulled: 2,
        created: 2,
        updated: 0,
        skipped: 0,
        invalid: 0,
        failed: 0,
        skips: [],
        invalids: [],
        failures: [],
      },
      payments: {
        pulled: 3,
        created: 3,
        updated: 0,
        skipped: 0,
        invalid: 0,
        failed: 0,
        skips: [],
        invalids: [],
        failures: [],
      },
    };
    commitImport.mockResolvedValue({ ok: true, report });
    const result = await commitImportAction(fd({ file: xlsxFile() }));
    expect(commitImport).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({ fileBuffer: expect.any(Buffer) })
    );
    expect(result).toEqual({ ok: true, report });
  });
});
