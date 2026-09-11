import { describe, it, expect, vi, beforeEach } from 'vitest';

const { managedOrgIds } = vi.hoisted(() => ({ managedOrgIds: vi.fn() }));
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ managedOrgIds, getCompanyTeamVisibility }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  listCertificates,
  createCertificate,
  issueFromOrderItem,
} from '@/lib/services/training/certificates';

function session(role: string, extra: Record<string, unknown> = {}) {
  return { sub: 'u1', role, companyId: 'c1', ...extra } as any;
}

const prisma = {
  certificate: {
    findMany: vi.fn(),
    // Хотфикс №40: по позиции заказа удостоверение одно — сервис сначала спрашивает.
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  student: { findUnique: vi.fn() },
  orderItem: { findUnique: vi.fn(), update: vi.fn() },
  organization: { findMany: vi.fn() },
  $transaction: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managedOrgIds.mockReturnValue(['org1']);
});

describe('certificates service', () => {
  it('listCertificates менеджера фильтрует по managedOrgIds', async () => {
    prisma.certificate.findMany.mockResolvedValue([{ id: 'cert1' }]);
    const res = await listCertificates(prisma, session('manager'), {});
    expect(res.ok).toBe(true);
    const callArg = prisma.certificate.findMany.mock.calls[0][0];
    expect(JSON.stringify(callArg.where)).toContain('org1');
  });

  it('PII: listCertificates журналирует studentId каждого удостоверения', async () => {
    prisma.certificate.findMany.mockResolvedValue([
      { id: 'cert1', studentId: 's1' },
      { id: 'cert2', studentId: 's2' },
    ]);
    const res = await listCertificates(prisma, session('manager'), {});
    expect(res.ok).toBe(true);
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        context: 'certificates_list',
        subjectIds: ['s1', 's2'],
      })
    );
  });

  it('createCertificate запрещён организации (read-only)', async () => {
    const res = await createCertificate(prisma, session('organization'), {
      studentId: 's1',
      directionId: 'd1',
      number: 'N',
      issuedAt: new Date(),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createCertificate денормализует organizationId из сотрудника', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.certificate.create.mockResolvedValue({ id: 'cert1' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1',
      directionId: 'd1',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.certificate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org1' }) })
    );
  });

  it('createCertificate для сотрудника вне scope → forbidden', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'OTHER' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1',
      directionId: 'd1',
      number: 'N',
      issuedAt: new Date(),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createCertificate с несуществующим directionId (P2003) → not_found', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.certificate.create.mockRejectedValue({ code: 'P2003' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1',
      directionId: 'BAD',
      number: 'N',
      issuedAt: new Date(),
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  // Стражи хотфикса №40: `Certificate.orderItemId` уникален, а сервис писал без
  // вопросов — повтор (устаревшая вкладка, двойное нажатие) ронял запрос с 500
  // вместо понятного «уже выдано».
  const p2002 = (target: unknown) =>
    Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });

  it('повторная выдача по той же позиции — «уже выдано», ничего не пишем', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'org1' },
    });
    prisma.certificate.findUnique.mockResolvedValue({ id: 'cert-old' });

    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: 'УД-2',
      issuedAt: new Date('2026-01-01'),
    });

    expect(res).toEqual({ ok: false, error: 'already_issued' });
    expect(prisma.certificate.create).not.toHaveBeenCalled();
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it('гонка двух одновременных выдач: P2002 → «уже выдано», а не падение', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'org1' },
    });
    prisma.certificate.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.certificate.create.mockRejectedValue(p2002(['orderItemId']));

    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: 'УД-3',
      issuedAt: new Date('2026-01-01'),
    });

    expect(res).toEqual({ ok: false, error: 'already_issued' });
  });

  it('чужое уникальное ограничение не маскируется — ошибка летит дальше', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'org1' },
    });
    prisma.certificate.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.certificate.create.mockRejectedValue(p2002(['number']));

    await expect(
      issueFromOrderItem(prisma, session('manager'), {
        orderItemId: 'it1',
        number: 'УД-4',
        issuedAt: new Date('2026-01-01'),
      })
    ).rejects.toThrow('Unique constraint failed');
  });

  it('issueFromOrderItem создаёт удостоверение и ставит статус certificate_issued', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'org1' },
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.certificate.create.mockResolvedValue({ id: 'cert1' });
    prisma.orderItem.update.mockResolvedValue({ id: 'it1' });
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: 'УД-1',
      issuedAt: new Date('2026-01-01'),
      validUntil: new Date('2031-01-01'),
    });
    expect(res.ok).toBe(true);
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'it1' },
      data: { trainingStatus: 'certificate_issued' },
    });
  });
});
