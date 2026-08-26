import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, getFinanceKpis, listStatements, render, partnerFindUnique } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    getFinanceKpis: vi.fn(),
    listStatements: vi.fn(),
    render: vi.fn(),
    partnerFindUnique: vi.fn(),
  })
);

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { partner: { findUnique: partnerFindUnique } } }));
vi.mock('@/lib/services/partner/finance', () => ({ getFinanceKpis, listStatements }));
vi.mock('@/lib/services/finance/commissionXlsx', () => ({
  renderCommissionStatementsXlsx: render,
}));

import { GET } from '@/app/api/partner/finance/export/route';

/**
 * `У-115`: выгрузка финансов есть и у заказчика, и у партнёра. Скоуп партнёра
 * берётся ТОЛЬКО из сессии — параметра «чей партнёр» у роута нет.
 */
describe('GET /api/partner/finance/export (У-115)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFinanceKpis.mockResolvedValue({ earnedTotal: 1, pendingTotal: 2, paidTotal: 3 });
    listStatements.mockResolvedValue([{ id: 's1' }]);
    partnerFindUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    render.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  });

  it('без сессии — 401', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(listStatements).not.toHaveBeenCalled();
  });

  it('чужая роль — 403, данные не читаются', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'manager' });
    expect((await GET()).status).toBe(403);
    expect(listStatements).not.toHaveBeenCalled();
  });

  it('партнёр без partnerId — 403, а не «фильтра нет»', async () => {
    // Пустой скоуп обязан значить «ничего не видно»: undefined снял бы фильтр
    // целиком и открыл комиссию всех партнёров.
    getSession.mockResolvedValue({ sub: 'u', role: 'partner', partnerId: null });
    expect((await GET()).status).toBe(403);
    expect(listStatements).not.toHaveBeenCalled();
  });

  it('отдаёт xlsx со своим скоупом и именем файла', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' });
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('commission-statements.xlsx');
    expect(listStatements).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ partnerId: 'p1' })
    );
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ partnerName: 'ООО Партнёр', total: 1 })
    );
  });

  it('партнёр без названия не роняет выгрузку', async () => {
    getSession.mockResolvedValue({ sub: 'u', role: 'partner', partnerId: 'p1' });
    partnerFindUnique.mockResolvedValue(null);
    expect((await GET()).status).toBe(200);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ partnerName: 'партнёр' }));
  });
});
