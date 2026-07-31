import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

/**
 * Этап 3 PR-2 (ФТ-6.5): export-роуты реестров удостоверений — гейты
 * флаг/сессия/роль, прокидка query-фильтров в ту же сервис-выборку, что у
 * экрана, и валидный xlsx на выходе (рендерер настоящий).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training/certificates', async (importOriginal) => {
  // certificateStatus/типы нужны настоящие (рендерер), мокается только выборка.
  const mod = await importOriginal<typeof import('@/lib/services/training/certificates')>();
  return { ...mod, listCertificates };
});

import { GET as orgExport } from '@/app/api/organization/certificates/export/route';
import { GET as partnerExport } from '@/app/api/partner/certificates/export/route';

const orgSession = { sub: 'o', role: 'organization' } as never;
const partnerSession = { sub: 'p', role: 'partner', partnerId: 'pt1' } as never;

const CERT = {
  id: 'c1',
  number: 'УД-1',
  issuedAt: new Date('2026-01-01'),
  validUntil: null,
  documentId: 'doc1',
  student: { id: 's1', name: 'Иванов Иван' },
  direction: { id: 'd1', name: 'Охрана труда' },
  organization: { id: 'org1', name: 'ООО Ромашка' },
};

const req = (url: string) => new Request(url);

beforeEach(() => {
  vi.resetAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  listCertificates.mockResolvedValue({ ok: true, certificates: [CERT], total: 1 });
});

describe('GET /api/organization/certificates/export', () => {
  it('404 при выключенном флаге; 401 без сессии; 403 не-организации', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await orgExport(req('http://x/'))).status).toBe(404);

    notFoundIfDisabled.mockReturnValue(null);
    getSession.mockResolvedValue(null);
    expect((await orgExport(req('http://x/'))).status).toBe(401);

    getSession.mockResolvedValue(partnerSession);
    expect((await orgExport(req('http://x/'))).status).toBe(403);
    expect(listCertificates).not.toHaveBeenCalled();
  });

  it('успех: фильтры из query уходят в сервис, тело — валидный xlsx без колонки «Организация»', async () => {
    getSession.mockResolvedValue(orgSession);
    const res = await orgExport(
      req(
        'http://x/api/organization/certificates/export?org=org1&direction=d1&status=expiring&search=%D0%98%D0%B2%D0%B0%D0%BD'
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('certificates.xlsx');
    expect(listCertificates).toHaveBeenCalledWith({}, orgSession, {
      organizationId: 'org1',
      directionId: 'd1',
      status: 'expiring',
      search: 'Иван',
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const headers: string[] = [];
    wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));
    expect(headers).toContain('Сотрудник');
    expect(headers).not.toContain('Организация');
  });

  it('неизвестный status игнорируется (undefined в сервис)', async () => {
    getSession.mockResolvedValue(orgSession);
    await orgExport(req('http://x/export?status=bogus'));
    expect(listCertificates).toHaveBeenCalledWith(
      {},
      orgSession,
      expect.objectContaining({ status: undefined })
    );
  });
});

describe('GET /api/partner/certificates/export', () => {
  it('404 при выключенном флаге; 401 без сессии; 403 не-партнёру', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await partnerExport(req('http://x/'))).status).toBe(404);

    notFoundIfDisabled.mockReturnValue(null);
    getSession.mockResolvedValue(null);
    expect((await partnerExport(req('http://x/'))).status).toBe(401);

    getSession.mockResolvedValue(orgSession);
    expect((await partnerExport(req('http://x/'))).status).toBe(403);
    expect(listCertificates).not.toHaveBeenCalled();
  });

  it('партнёрская выгрузка без фильтров: пустые query-параметры не уходят в сервис', async () => {
    // Пустой параметр в адресе (?organization=) означает «все», а не поиск
    // организации с пустым названием. И незнакомый статус тоже игнорируется.
    getSession.mockResolvedValue(partnerSession);
    await partnerExport(req('http://x/export?organization=&status=bogus'));
    expect(listCertificates).toHaveBeenCalledWith({}, partnerSession, {
      organizationId: undefined,
      directionId: undefined,
      status: undefined,
      search: undefined,
    });
  });

  it('успех: фильтр organization уходит в сервис, xlsx содержит колонку «Организация»', async () => {
    getSession.mockResolvedValue(partnerSession);
    const res = await partnerExport(req('http://x/export?organization=org1&status=expired'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('partner-certificates.xlsx');
    expect(listCertificates).toHaveBeenCalledWith({}, partnerSession, {
      organizationId: 'org1',
      directionId: undefined,
      status: 'expired',
      search: undefined,
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const headers: string[] = [];
    wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));
    expect(headers).toContain('Организация');
    const row2: string[] = [];
    wb.worksheets[0].getRow(2).eachCell((c) => row2.push(String(c.value)));
    expect(row2).toContain('ООО Ромашка');
  });
});
