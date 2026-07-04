import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks (mirror services.training.*.test.ts) ────────────────────────────────
const { managedOrgIds } = vi.hoisted(() => ({ managedOrgIds: vi.fn() }));
const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
const { getOrder } = vi.hoisted(() => ({ getOrder: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('@/lib/auth/managerPolicy', () => ({ managedOrgIds, getCompanyTeamVisibility }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  listCertificates,
  createCertificate,
  issueFromOrderItem,
} from '@/lib/services/training/certificates';
import {
  addOrderItem,
  updateItemStatus,
  removeOrderItem,
} from '@/lib/services/training/orderItems';
import {
  listDirections,
  createDirection,
  updateDirection,
  deactivateDirection,
} from '@/lib/services/training/directions';

function session(role: string, extra: Record<string, unknown> = {}) {
  return { sub: 'u1', role, managerRole: null, companyId: 'c1', ...extra } as any;
}

const prisma = {
  certificate: { findMany: vi.fn(), create: vi.fn() },
  student: { findUnique: vi.fn() },
  orderItem: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  organization: { findMany: vi.fn() },
  trainingDirection: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managedOrgIds.mockReturnValue(['org1']);
});

// ─────────────────────────────────────────────────────────────────────────────
// certificates.ts — scopeOrgIds role variants + validation/scope/error paths
// ─────────────────────────────────────────────────────────────────────────────
describe('cov certificates.scopeOrgIds role variants', () => {
  it('admin → scope null (no organizationId filter) [L28]', async () => {
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('admin'), {});
    expect(res.ok).toBe(true);
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBeUndefined();
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
  });

  it('manager teamMode=ON → org ids of own company [L32-37]', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    prisma.organization.findMany.mockResolvedValue([{ id: 'orgA' }, { id: 'orgB' }]);
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('manager', { companyId: 'c1' }), {});
    expect(res.ok).toBe(true);
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } }),
    );
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['orgA', 'orgB'] });
  });

  it('manager teamMode=ON but companyId null → falls back to managedOrgIds [L32 false]', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    managedOrgIds.mockReturnValue(['mgd1']);
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('manager', { companyId: null }), {});
    expect(res.ok).toBe(true);
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['mgd1'] });
  });

  it('partner → org ids by partnerId [L40,42-47]', async () => {
    prisma.organization.findMany.mockResolvedValue([{ id: 'porg' }]);
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('partner', { partnerId: 'p1' }), {});
    expect(res.ok).toBe(true);
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: 'p1' } }),
    );
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['porg'] });
  });

  it('partner without partnerId → sentinel __none__ [L44 ?? branch]', async () => {
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('partner', { partnerId: undefined }), {});
    expect(res.ok).toBe(true);
    expect(prisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: '__none__' } }),
    );
  });

  it('organization → active membership org ids only [L50-54]', async () => {
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(
      prisma,
      session('organization', {
        organizationMemberships: [
          { organizationId: 'oActive', isActive: true },
          { organizationId: 'oInactive', isActive: false },
        ],
      }),
      {},
    );
    expect(res.ok).toBe(true);
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['oActive'] });
  });

  it('organization without memberships array → [] (?? branch) [L52]', async () => {
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(
      prisma,
      session('organization', { organizationMemberships: undefined }),
      {},
    );
    expect(res.ok).toBe(true);
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: [] });
  });

  it('unknown role → empty scope [L57]', async () => {
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('student'), {});
    expect(res.ok).toBe(true);
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: [] });
  });
});

describe('cov certificates.listCertificates filters', () => {
  it('studentId + expiringWithinDays build where clause [L68,69,70-72]', async () => {
    prisma.certificate.findMany.mockResolvedValue([]);
    const res = await listCertificates(prisma, session('manager'), {
      studentId: 's1',
      expiringWithinDays: 30,
    });
    expect(res.ok).toBe(true);
    const where = prisma.certificate.findMany.mock.calls[0][0].where;
    expect(where.studentId).toBe('s1');
    expect(where.validUntil).toEqual(
      expect.objectContaining({ not: null, lte: expect.any(Date) }),
    );
  });
});

describe('cov certificates.createCertificate paths', () => {
  it('empty number → validation [L111]', async () => {
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1',
      directionId: 'd1',
      number: '   ',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('student not found (assertStudentInScope null) → forbidden [L90]', async () => {
    prisma.student.findUnique.mockResolvedValue(null);
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 'missing',
      directionId: 'd1',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('comment trimmed to null + validUntil null defaults [L125,128]', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.certificate.create.mockResolvedValue({ id: 'cert1', number: 'N' });
    const res = await createCertificate(prisma, session('manager'), {
      studentId: 's1',
      directionId: 'd1',
      number: '  N  ',
      issuedAt: new Date('2026-01-01'),
      comment: '   ',
    });
    expect(res.ok).toBe(true);
    const data = prisma.certificate.create.mock.calls[0][0].data;
    expect(data.comment).toBeNull();
    expect(data.validUntil).toBeNull();
    expect(data.number).toBe('N');
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'certificate_created' }),
    );
  });

  it('non-P2003 create error is rethrown [L133-135]', async () => {
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.certificate.create.mockRejectedValue({ code: 'P2000', message: 'boom' });
    await expect(
      createCertificate(prisma, session('manager'), {
        studentId: 's1',
        directionId: 'd1',
        number: 'N',
        issuedAt: new Date('2026-01-01'),
      }),
    ).rejects.toEqual({ code: 'P2000', message: 'boom' });
  });
});

describe('cov certificates.issueFromOrderItem paths', () => {
  it('forbidden for non-editor role [L159]', async () => {
    const res = await issueFromOrderItem(prisma, session('organization'), {
      orderItemId: 'it1',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('empty number → validation [L160]', async () => {
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: '  ',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('order item not found → not_found [L170]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue(null);
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'missing',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('order item out of scope → forbidden [L173-175]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'OTHER' },
    });
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('issues with validUntil omitted → null default [L186]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({
      id: 'it1',
      directionId: 'd1',
      student: { id: 's1', organizationId: 'org1' },
    });
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.certificate.create.mockResolvedValue({ id: 'cert1', number: 'N' });
    prisma.orderItem.update.mockResolvedValue({ id: 'it1' });
    const res = await issueFromOrderItem(prisma, session('manager'), {
      orderItemId: 'it1',
      number: 'N',
      issuedAt: new Date('2026-01-01'),
    });
    expect(res.ok).toBe(true);
    const data = prisma.certificate.create.mock.calls[0][0].data;
    expect(data.validUntil).toBeNull();
    expect(data.documentId).toBeNull();
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'certificate_issued' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orderItems.ts — non-P2002 rethrow + removeOrderItem + branch variants
// ─────────────────────────────────────────────────────────────────────────────
describe('cov orderItems.addOrderItem error rethrow', () => {
  it('order not visible → forbidden [L49]', async () => {
    getOrder.mockResolvedValue(null);
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('student not found → not_found [L54]', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue(null);
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 'missing',
      directionId: 'd1',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('direction not found → not_found [L60]', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue(null);
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'missing',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('note trimmed to null (|| null branch) on success [L67]', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockResolvedValue({ id: 'it1' });
    const res = await addOrderItem(prisma, session('manager'), {
      orderId: 'o1',
      studentId: 's1',
      directionId: 'd1',
      note: '   ',
    });
    expect(res.ok).toBe(true);
    const data = prisma.orderItem.create.mock.calls[0][0].data;
    expect(data.note).toBeNull();
  });

  it('non-P2002 create error is rethrown [L77,78-79]', async () => {
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.student.findUnique.mockResolvedValue({ id: 's1', organizationId: 'org1' });
    prisma.trainingDirection.findUnique.mockResolvedValue({ id: 'd1', isActive: true });
    prisma.orderItem.create.mockRejectedValue({ code: 'P2010', message: 'raw' });
    await expect(
      addOrderItem(prisma, session('manager'), {
        orderId: 'o1',
        studentId: 's1',
        directionId: 'd1',
      }),
    ).rejects.toEqual({ code: 'P2010', message: 'raw' });
  });
});

describe('cov orderItems.updateItemStatus branch variants', () => {
  it('forbidden for non-editor role [L87]', async () => {
    const res = await updateItemStatus(prisma, session('partner'), {
      itemId: 'it1',
      trainingStatus: 'in_progress',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('item not found → not_found [L91]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue(null);
    const res = await updateItemStatus(prisma, session('manager'), {
      itemId: 'missing',
      trainingStatus: 'in_progress',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('order not visible → forbidden [L93]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({ id: 'it1', orderId: 'o1', trainingStatus: 'not_started' });
    getOrder.mockResolvedValue(null);
    const res = await updateItemStatus(prisma, session('manager'), {
      itemId: 'it1',
      trainingStatus: 'in_progress',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('cov orderItems.removeOrderItem', () => {
  it('forbidden for non-editor role [L109]', async () => {
    const res = await removeOrderItem(prisma, session('organization'), { itemId: 'it1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.orderItem.findUnique).not.toHaveBeenCalled();
  });

  it('item not found → not_found [L113]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue(null);
    const res = await removeOrderItem(prisma, session('manager'), { itemId: 'missing' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('order not visible → forbidden [L115]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({ id: 'it1', orderId: 'o1' });
    getOrder.mockResolvedValue(null);
    const res = await removeOrderItem(prisma, session('manager'), { itemId: 'it1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.orderItem.delete).not.toHaveBeenCalled();
  });

  it('deletes item + writes audit [L116-120]', async () => {
    prisma.orderItem.findUnique.mockResolvedValue({ id: 'it1', orderId: 'o1' });
    getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1' });
    prisma.orderItem.delete.mockResolvedValue({ id: 'it1' });
    const res = await removeOrderItem(prisma, session('manager'), { itemId: 'it1' });
    expect(res).toEqual({ ok: true, removed: true });
    expect(prisma.orderItem.delete).toHaveBeenCalledWith({ where: { id: 'it1' } });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'order_item_removed', entityId: 'it1' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// directions.ts — updateDirection full body + branches
// ─────────────────────────────────────────────────────────────────────────────
describe('cov directions branch alternates', () => {
  it('listDirections includeInactive=true → empty where [L18 true branch]', async () => {
    prisma.trainingDirection.findMany.mockResolvedValue([]);
    const res = await listDirections(prisma, session('admin'), { includeInactive: true });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('createDirection with slug + sortOrder provided [L33 truthy branches]', async () => {
    prisma.trainingDirection.create = vi.fn().mockResolvedValue({ id: 'd9', name: 'Z' });
    const res = await createDirection(prisma, session('admin'), {
      name: '  Z  ',
      slug: '  z-slug  ',
      sortOrder: 3,
    });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.create).toHaveBeenCalledWith({
      data: { name: 'Z', slug: 'z-slug', sortOrder: 3 },
    });
  });

  it('deactivateDirection forbidden for plain manager [L60 false branch]', async () => {
    const res = await deactivateDirection(prisma, session('manager'), { id: 'd1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.trainingDirection.update).not.toHaveBeenCalled();
  });
});

describe('cov directions.updateDirection', () => {
  it('forbidden for plain manager (not leader) [L43]', async () => {
    const res = await updateDirection(prisma, session('manager'), { id: 'd1', name: 'X' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.trainingDirection.update).not.toHaveBeenCalled();
  });

  it('empty trimmed name → validation [L45-47]', async () => {
    const res = await updateDirection(prisma, session('admin'), { id: 'd1', name: '   ' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(prisma.trainingDirection.update).not.toHaveBeenCalled();
  });

  it('updates name + sortOrder [L48-52]', async () => {
    prisma.trainingDirection.update.mockResolvedValue({ id: 'd1', name: 'Y', sortOrder: 5 });
    const res = await updateDirection(prisma, session('manager', { managerRole: 'leader' }), {
      id: 'd1',
      name: '  Y  ',
      sortOrder: 5,
    });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { name: 'Y', sortOrder: 5 },
    });
  });

  it('updates sortOrder only (name undefined branch) [L45 false]', async () => {
    prisma.trainingDirection.update.mockResolvedValue({ id: 'd1', sortOrder: 9 });
    const res = await updateDirection(prisma, session('admin'), { id: 'd1', sortOrder: 9 });
    expect(res.ok).toBe(true);
    expect(prisma.trainingDirection.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { sortOrder: 9 },
    });
  });
});
