import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

/**
 * Этап 9 PR-3 (ФТ-12.2): клиентские выгрузки организации — платежи/долг и
 * сотрудники. Организация выгружает СВОИ данные: активная организация
 * резолвится как на странице (query → cookie → первая доступная), чужой `?org=`
 * игнорируется. В PiiAccessEvent такие выгрузки не пишутся (ФТ-12.1).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

const { cookies } = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock('next/headers', () => ({ cookies }));

vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUnique: vi.fn() } } }));

const { getOrgFinanceKpis, listOrgPaymentsForExport } = vi.hoisted(() => ({
  getOrgFinanceKpis: vi.fn(),
  listOrgPaymentsForExport: vi.fn(),
}));
vi.mock('@/lib/services/organization/finance', () => ({
  getOrgFinanceKpis,
  listOrgPaymentsForExport,
}));

const { listOrgStudentsForExport } = vi.hoisted(() => ({ listOrgStudentsForExport: vi.fn() }));
vi.mock('@/lib/services/organization/students', () => ({ listOrgStudentsForExport }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { prisma } from '@/lib/db/prisma';
import { GET as financeExport } from '@/app/api/organization/finance/export/route';
import { GET as studentsExport } from '@/app/api/organization/students/export/route';

const orgSession = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [
    { organizationId: 'orgA', isActive: true, roleInOrg: 'admin' },
    { organizationId: 'orgB', isActive: true, roleInOrg: 'member' },
  ],
} as never;
const partnerSession = { sub: 'p1', role: 'partner' } as never;

const STUDENT = {
  id: 's1',
  name: 'Иванов Иван',
  email: 'i@x.ru',
  position: 'Инженер',
  externalStudentId: null,
  createdAt: new Date('2026-01-10'),
  activeCertificates: 3,
};

const req = (url: string) => new Request(url);
const noCookie = () => ({ get: () => undefined });

beforeEach(() => {
  vi.resetAllMocks();
  cookies.mockResolvedValue(noCookie());
  listOrgPaymentsForExport.mockResolvedValue({ rows: [], total: 0 });
  getOrgFinanceKpis.mockResolvedValue({ billed: '10.00', paid: '4.00', outstanding: '6.00' });
  listOrgStudentsForExport.mockResolvedValue({ rows: [STUDENT], total: 1 });
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ name: 'ООО Ромашка' } as never);
});

describe('GET /api/organization/finance/export', () => {
  it('401 без сессии, 403 не-организации', async () => {
    getSession.mockResolvedValue(null);
    expect((await financeExport(req('http://x/e'))).status).toBe(401);

    getSession.mockResolvedValue(partnerSession);
    expect((await financeExport(req('http://x/e'))).status).toBe(403);
    expect(listOrgPaymentsForExport).not.toHaveBeenCalled();
  });

  it('успех: активная организация из query, xlsx с листами «Платежи» и «Итоги»', async () => {
    getSession.mockResolvedValue(orgSession);
    const res = await financeExport(req('http://x/e?org=orgB'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('payments.xlsx');
    expect(listOrgPaymentsForExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'orgB',
      limit: 10_000,
    });
    expect(recordPiiAccess).not.toHaveBeenCalled();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Платежи', 'Итоги']);
  });

  it('чужой ?org= игнорируется — берётся своя организация', async () => {
    getSession.mockResolvedValue(orgSession);
    await financeExport(req('http://x/e?org=foreign'));
    expect(listOrgPaymentsForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'orgA' })
    );
  });

  it('без query берётся организация из cookie', async () => {
    getSession.mockResolvedValue(orgSession);
    cookies.mockResolvedValue({ get: () => ({ value: 'orgB' }) });
    await financeExport(req('http://x/e'));
    expect(listOrgPaymentsForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'orgB' })
    );
  });

  it('организация без записи в БД — прочерк в названии', async () => {
    getSession.mockResolvedValue(orgSession);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as never);
    const res = await financeExport(req('http://x/e'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.getWorksheet('Итоги')!.getColumn(2).values.map(String)).toContain('—');
  });
});

describe('GET /api/organization/students/export', () => {
  it('401 без сессии, 403 не-организации', async () => {
    getSession.mockResolvedValue(null);
    expect((await studentsExport(req('http://x/e'))).status).toBe(401);

    getSession.mockResolvedValue(partnerSession);
    expect((await studentsExport(req('http://x/e'))).status).toBe(403);
    expect(listOrgStudentsForExport).not.toHaveBeenCalled();
  });

  it('успех: поиск экрана уходит в сервис, файл содержит должность и счётчик', async () => {
    getSession.mockResolvedValue(orgSession);
    const res = await studentsExport(req('http://x/e?org=orgA&search=Иван'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('students.xlsx');
    expect(listOrgStudentsForExport).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'orgA',
      search: 'Иван',
      limit: 10_000,
    });
    expect(recordPiiAccess).not.toHaveBeenCalled();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const row: string[] = [];
    wb.worksheets[0]!.getRow(2).eachCell((c) => row.push(String(c.value)));
    expect(row).toContain('Инженер');
    expect(row).toContain('3');
  });

  it('пустой поиск не превращается в пустую строку', async () => {
    getSession.mockResolvedValue(orgSession);
    await studentsExport(req('http://x/e?search='));
    expect(listOrgStudentsForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: undefined })
    );
  });

  it('без query активная организация берётся из cookie', async () => {
    getSession.mockResolvedValue(orgSession);
    cookies.mockResolvedValue({ get: () => ({ value: 'orgB' }) });
    await studentsExport(req('http://x/e'));
    expect(listOrgStudentsForExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'orgB' })
    );
  });
});
