import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';

/**
 * Этап 9 PR-3 (ФТ-12.2): staff-выгрузки — заказы (/manager, /leader) и
 * карточка организации (удостоверения, платежи). Проверяем гейты роли/скоупа,
 * прокидку фильтров в ту же сервис-выборку, что у экрана, запись PiiAccessEvent
 * для выгрузки ПДн и валидный xlsx на выходе (рендереры настоящие).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUnique: vi.fn() } } }));

const { listOrdersForExport } = vi.hoisted(() => ({ listOrdersForExport: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ listOrdersForExport }));

const { canManagerAccessOrg } = vi.hoisted(() => ({ canManagerAccessOrg: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ canManagerAccessOrg }));

const { listCertificates } = vi.hoisted(() => ({ listCertificates: vi.fn() }));
vi.mock('@/lib/services/training/certificates', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/services/training/certificates')>();
  return { ...mod, listCertificates };
});

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

const { getOrgFinanceKpis, listOrgPaymentsForExport } = vi.hoisted(() => ({
  getOrgFinanceKpis: vi.fn(),
  listOrgPaymentsForExport: vi.fn()
}));
vi.mock('@/lib/services/organization/finance', () => ({
  getOrgFinanceKpis,
  listOrgPaymentsForExport
}));

import { prisma } from '@/lib/db/prisma';
import { GET as ordersExport } from '@/app/api/manager/orders/export/route';
import { GET as orgCertsExport } from '@/app/api/manager/organizations/[id]/certificates/export/route';
import { GET as orgPaymentsExport } from '@/app/api/manager/organizations/[id]/payments/export/route';

const managerSession = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const leaderSession = {
  sub: 'l1',
  role: 'manager',
  managerRole: 'leader',
  companyId: 'c1'
} as never;
const orgSession = { sub: 'o1', role: 'organization' } as never;

const ORDER = {
  id: 'o1',
  orderNumber: 'ЗК-1',
  title: 'Обучение',
  organization: { id: 'org1', name: 'ООО Ромашка' },
  manager: { id: 'm1', name: 'Петров', email: 'p@x.ru' },
  executionStatus: 'pending',
  financialStatus: 'billed',
  totalAmount: new Prisma.Decimal('100.00'),
  paidAmount: new Prisma.Decimal('0.00'),
  createdAt: new Date('2026-02-01')
};

const CERT = {
  id: 'c1',
  number: 'УД-1',
  issuedAt: new Date('2026-01-01'),
  validUntil: null,
  documentId: null,
  studentId: 's1',
  student: { id: 's1', name: 'Иванов Иван' },
  direction: { id: 'd1', name: 'Охрана труда' },
  organization: { id: 'org1', name: 'ООО Ромашка' }
};

const req = (url: string) => new Request(url);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  canManagerAccessOrg.mockResolvedValue(true);
  listOrdersForExport.mockResolvedValue({ rows: [ORDER], total: 1 });
  listCertificates.mockResolvedValue({ ok: true, certificates: [CERT], total: 1 });
  listOrgPaymentsForExport.mockResolvedValue({ rows: [], total: 0 });
  getOrgFinanceKpis.mockResolvedValue({ billed: '100.00', paid: '0.00', outstanding: '100.00' });
  recordPiiAccess.mockResolvedValue(undefined);
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ name: 'ООО Ромашка' } as never);
});

describe('GET /api/manager/orders/export', () => {
  it('401 без сессии, 403 не-менеджеру', async () => {
    getSession.mockResolvedValue(null);
    expect((await ordersExport(req('http://x/e'))).status).toBe(401);

    getSession.mockResolvedValue(orgSession);
    expect((await ordersExport(req('http://x/e'))).status).toBe(403);
    expect(listOrdersForExport).not.toHaveBeenCalled();
  });

  it('фильтры экрана уходят в сервис; тело — валидный xlsx', async () => {
    getSession.mockResolvedValue(managerSession);
    const res = await ordersExport(
      req('http://x/e?search=abc&executionStatus=pending&financialStatus=billed&organizationId=org1&unassigned=1')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('orders.xlsx');
    expect(listOrdersForExport).toHaveBeenCalledWith(expect.anything(), {
      session: managerSession,
      search: 'abc',
      executionStatus: 'pending',
      financialStatus: 'billed',
      organizationId: 'org1',
      unassigned: true
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets[0]!.name).toBe('Заказы');
  });

  it('пустые фильтры не превращаются в пустые строки', async () => {
    getSession.mockResolvedValue(managerSession);
    await ordersExport(req('http://x/e?search=&unassigned=0'));
    expect(listOrdersForExport).toHaveBeenCalledWith(expect.anything(), {
      session: managerSession,
      search: undefined,
      executionStatus: undefined,
      financialStatus: undefined,
      organizationId: undefined,
      unassigned: undefined
    });
  });

  it('scope=company даёт company-wide только лидеру', async () => {
    getSession.mockResolvedValue(leaderSession);
    await ordersExport(req('http://x/e?scope=company'));
    expect(listOrdersForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ teamModeOverride: true })
    );

    // обычный менеджер тем же параметром скоуп не расширяет
    listOrdersForExport.mockClear();
    getSession.mockResolvedValue(managerSession);
    await ordersExport(req('http://x/e?scope=company'));
    expect(listOrdersForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ teamModeOverride: true })
    );
  });
});

describe('GET /api/manager/organizations/[id]/certificates/export', () => {
  it('404 при выключенном флаге; 401 без сессии; 403 не-менеджеру', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await orgCertsExport(req('http://x/e'), params('org1'))).status).toBe(404);

    notFoundIfDisabled.mockReturnValue(null);
    getSession.mockResolvedValue(null);
    expect((await orgCertsExport(req('http://x/e'), params('org1'))).status).toBe(401);

    getSession.mockResolvedValue(orgSession);
    expect((await orgCertsExport(req('http://x/e'), params('org1'))).status).toBe(403);
  });

  it('404 для организации вне скоупа — существование не подтверждаем', async () => {
    getSession.mockResolvedValue(managerSession);
    canManagerAccessOrg.mockResolvedValue(false);
    const res = await orgCertsExport(req('http://x/e'), params('foreign'));
    expect(res.status).toBe(404);
    expect(listCertificates).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('успех: фильтры вкладки в сервис, PiiAccessEvent с действием export, xlsx', async () => {
    getSession.mockResolvedValue(managerSession);
    const res = await orgCertsExport(
      req('http://x/e?direction=d1&status=expiring&search=Иван'),
      params('org1')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('certificates.xlsx');
    expect(listCertificates).toHaveBeenCalledWith(expect.anything(), managerSession, {
      organizationId: 'org1',
      directionId: 'd1',
      status: 'expiring',
      search: 'Иван'
    });
    expect(recordPiiAccess).toHaveBeenCalledWith(expect.anything(), {
      session: managerSession,
      context: 'org_card_certificates_export',
      subjectIds: ['s1'],
      meta: { take: 1, hasQuery: true }
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets[0]!.name).toBe('Удостоверения');
  });

  it('неизвестный status игнорируется', async () => {
    getSession.mockResolvedValue(managerSession);
    await orgCertsExport(req('http://x/e?status=bogus'), params('org1'));
    expect(listCertificates).toHaveBeenCalledWith(
      expect.anything(),
      managerSession,
      expect.objectContaining({ status: undefined })
    );
  });
});

describe('GET /api/manager/organizations/[id]/payments/export', () => {
  it('401 без сессии; 403 не-менеджеру; 404 вне скоупа', async () => {
    getSession.mockResolvedValue(null);
    expect((await orgPaymentsExport(req('http://x/e'), params('org1'))).status).toBe(401);

    getSession.mockResolvedValue(orgSession);
    expect((await orgPaymentsExport(req('http://x/e'), params('org1'))).status).toBe(403);

    getSession.mockResolvedValue(managerSession);
    canManagerAccessOrg.mockResolvedValue(false);
    expect((await orgPaymentsExport(req('http://x/e'), params('foreign'))).status).toBe(404);
    expect(listOrgPaymentsForExport).not.toHaveBeenCalled();
  });

  it('успех: леджер + KPI организации в файле', async () => {
    getSession.mockResolvedValue(managerSession);
    const res = await orgPaymentsExport(req('http://x/e'), params('org1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('payments.xlsx');
    expect(listOrgPaymentsForExport).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org1', limit: 10_000 }
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.getWorksheet('Итоги')!.getColumn(2).values.map(String)).toContain('ООО Ромашка');
  });

  it('организация без записи в БД — прочерк вместо названия', async () => {
    getSession.mockResolvedValue(managerSession);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never);
    const res = await orgPaymentsExport(req('http://x/e'), params('org1'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.getWorksheet('Итоги')!.getColumn(2).values.map(String)).toContain('—');
  });
});
