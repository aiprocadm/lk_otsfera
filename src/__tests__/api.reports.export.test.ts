import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Маршрут выгрузки отчёта (`У-244`, `У-249`, этап 7).
 *
 * Маршрут тонкий: флаг → сессия → ключ из реестра → право → файл. Проверяется
 * порядок: право стоит ДО сборки, и запрещённый отчёт не читает ни строки.
 */
const { getSession, notFoundIfDisabled, buildReportXlsx, canRunReport } = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  buildReportXlsx: vi.fn(),
  canRunReport: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/reports/export', () => ({ buildReportXlsx }));
vi.mock('@/lib/reports/registry', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/reports/registry')>('@/lib/reports/registry');
  return { ...actual, canRunReport };
});

import { GET } from '@/app/api/reports/[key]/export/route';

const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' };
const ADMIN = { sub: 'a1', role: 'admin', companyId: 'c1' };

const req = (url = 'http://x/api/reports/receivables/export') => new Request(url);
const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(LEADER);
  canRunReport.mockReturnValue(true);
  buildReportXlsx.mockResolvedValue({
    ok: true,
    buffer: Buffer.from('xlsx'),
    fileName: 'receivables-2026-09.xlsx',
  });
});

describe('GET /api/reports/[key]/export', () => {
  it('без сессии — 401, отчёт не собирается', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req(), ctx('receivables'));
    expect(res.status).toBe(401);
    expect(buildReportXlsx).not.toHaveBeenCalled();
  });

  it('незнакомый ключ — 404, а не пустой файл', async () => {
    const res = await GET(req(), ctx('выдуманный'));
    expect(res.status).toBe(404);
    expect(buildReportXlsx).not.toHaveBeenCalled();
  });

  it('нет права — 403 ДО выборки', async () => {
    canRunReport.mockReturnValue(false);
    const res = await GET(req(), ctx('receivables'));
    expect(res.status).toBe(403);
    // Пустой файл человек принял бы за «данных нет» — поэтому именно отказ.
    expect(buildReportXlsx).not.toHaveBeenCalled();
  });

  it('успех: файл с правильным типом и именем', async () => {
    const res = await GET(req(), ctx('receivables'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('receivables-2026-09.xlsx');
  });

  it('слишком много строк — 413 с русской подсказкой, файла нет', async () => {
    buildReportXlsx.mockResolvedValue({
      ok: false,
      error: 'too_many',
      total: 80_000,
      limit: 50_000,
    });
    const res = await GET(req(), ctx('receivables'));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('too_many');
    // Человек должен понять, что делать: сообщение называет и число, и выход.
    expect(String(body.message)).toContain('узкий период');
    expect(String(body.message)).toContain('80000');
  });

  it('период и фильтр читаются из адреса', async () => {
    await GET(
      req('http://x/api/reports/receivables/export?month=2026-05&older=60'),
      ctx('receivables')
    );
    expect(buildReportXlsx.mock.calls[0][1]).toMatchObject({
      year: 2026,
      month: 5,
      olderThanDays: 60,
    });
  });

  it('компанию выбирает ТОЛЬКО администратор', async () => {
    // У руководителя чужой идентификатор в адресе ничего не меняет.
    await GET(req('http://x/api/reports/receivables/export?company=чужая'), ctx('receivables'));
    expect(buildReportXlsx.mock.calls[0][1]).toMatchObject({ companyId: 'c1' });

    vi.clearAllMocks();
    canRunReport.mockReturnValue(true);
    buildReportXlsx.mockResolvedValue({ ok: true, buffer: Buffer.from('x'), fileName: 'f.xlsx' });
    getSession.mockResolvedValue(ADMIN);
    await GET(req('http://x/api/reports/receivables/export?company=c2'), ctx('receivables'));
    expect(buildReportXlsx.mock.calls[0][1]).toMatchObject({ companyId: 'c2' });
  });

  it('сотрудник без компании — 400, а не пустой отчёт', async () => {
    getSession.mockResolvedValue({ sub: 'l2', role: 'leader' });
    const res = await GET(req(), ctx('receivables'));
    expect(res.status).toBe(400);
    expect(buildReportXlsx).not.toHaveBeenCalled();
  });

  it('раздел закрыт флагом — маршрут тоже закрыт', async () => {
    await GET(req(), ctx('receivables'));
    expect(notFoundIfDisabled).toHaveBeenCalledWith('leader_analytics');
  });
});
