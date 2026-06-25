import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
const { previewPaymentImport, commitPaymentImport } = vi.hoisted(() => ({ previewPaymentImport: vi.fn(), commitPaymentImport: vi.fn() }));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({ previewPaymentImport, commitPaymentImport, resolveQueueRow: vi.fn(), dismissQueueRow: vi.fn() }));

import { previewPaymentImportAction } from '@/server-actions/payment-import';

beforeEach(() => { vi.clearAllMocks(); requireSession.mockResolvedValue({ sub: 'u1', role: 'admin' }); });

function form(file?: File): FormData { const f = new FormData(); if (file) f.set('file', file); return f; }

describe('previewPaymentImportAction', () => {
  it('rejects non-file', async () => {
    expect(await previewPaymentImportAction(form())).toEqual({ ok: false, error: 'invalid_file' });
  });
  it('rejects wrong extension', async () => {
    const file = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    expect(await previewPaymentImportAction(form(file))).toEqual({ ok: false, error: 'invalid_file' });
  });
  it('accepts .xls and delegates', async () => {
    previewPaymentImport.mockResolvedValue({ ok: true, plan: { counts: {} } });
    const file = new File(['x'], 'card.xls');
    const res = await previewPaymentImportAction(form(file));
    expect(res.ok).toBe(true);
    expect(previewPaymentImport).toHaveBeenCalledOnce();
  });
  it('accepts .xlsx and delegates', async () => {
    previewPaymentImport.mockResolvedValue({ ok: true, plan: { counts: {} } });
    const file = new File(['x'], 'card.xlsx');
    expect((await previewPaymentImportAction(form(file))).ok).toBe(true);
  });
});
