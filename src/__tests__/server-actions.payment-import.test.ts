import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
const { previewPaymentImport, commitPaymentImport, searchResolveOrgs, listResolveOrders } =
  vi.hoisted(() => ({
    previewPaymentImport: vi.fn(),
    commitPaymentImport: vi.fn(),
    searchResolveOrgs: vi.fn(),
    listResolveOrders: vi.fn(),
  }));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({
  previewPaymentImport,
  commitPaymentImport,
  resolveQueueRow: vi.fn(),
  dismissQueueRow: vi.fn(),
  searchResolveOrgs,
  listResolveOrders,
}));

import {
  previewPaymentImportAction,
  searchResolveOrgsAction,
  listResolveOrdersAction,
} from '@/server-actions/payment-import';

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'admin' });
});

function form(file?: File): FormData {
  const f = new FormData();
  if (file) f.set('file', file);
  return f;
}

describe('previewPaymentImportAction', () => {
  it('rejects non-file', async () => {
    expect(await previewPaymentImportAction(form())).toEqual({ ok: false, error: 'invalid_file' });
  });
  it('rejects wrong extension', async () => {
    const file = new File(['x'], 'c.pdf', { type: 'application/pdf' });
    expect(await previewPaymentImportAction(form(file))).toEqual({
      ok: false,
      error: 'invalid_file',
    });
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

describe('searchResolveOrgsAction', () => {
  it('delegates to the scoped org search with the session', async () => {
    searchResolveOrgs.mockResolvedValue([{ id: 'o1', name: 'A', inn: null }]);
    const res = await searchResolveOrgsAction({ q: 'A' });
    expect(res).toEqual([{ id: 'o1', name: 'A', inn: null }]);
    expect(searchResolveOrgs).toHaveBeenCalledWith({}, { sub: 'u1', role: 'admin' }, { q: 'A' });
  });
});

describe('listResolveOrdersAction', () => {
  it('delegates to the scoped order list with the session', async () => {
    listResolveOrders.mockResolvedValue([{ id: 'ord1', orderNumber: '7', title: 'X' }]);
    const res = await listResolveOrdersAction({ organizationId: 'o1' });
    expect(res).toEqual([{ id: 'ord1', orderNumber: '7', title: 'X' }]);
    expect(listResolveOrders).toHaveBeenCalledWith(
      {},
      { sub: 'u1', role: 'admin' },
      { organizationId: 'o1' }
    );
  });
});
