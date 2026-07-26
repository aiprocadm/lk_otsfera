/**
 * Этап 8 (PR-1) — сервисы реквизитов: гейты ролей/подролей, валидация,
 * P2002-дубль ИНН → русская валидация, аудит с маскировкой счёта.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { getOrgRequisites, setOrgRequisites } from '@/lib/services/organization/requisites';
import { getPartnerRequisites, setPartnerRequisites } from '@/lib/services/partner/requisites';
import { listCompaniesRequisites, setCompanyRequisites } from '@/lib/services/admin/companyRequisites';
import {
  getOrgRequisitesByAdmin,
  setOrgRequisitesByAdmin,
  setPartnerRequisitesByAdmin
} from '@/lib/services/admin/counterpartyRequisites';

const P2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' });

const orgMember = (roleInOrg: string, orgId = 'org-1'): SessionPayload =>
  ({
    sub: 'u1',
    role: 'organization',
    organizationMemberships: [{ organizationId: orgId, roleInOrg, isActive: true }]
  } as unknown as SessionPayload);
const partnerSession = (partnerRole: 'admin' | 'manager'): SessionPayload =>
  ({ sub: 'p1', role: 'partner', partnerId: 'pt-1', partnerRole } as unknown as SessionPayload);
const adminSession = (): SessionPayload => ({ sub: 'a1', role: 'admin' } as unknown as SessionPayload);

function fake(model: 'organization' | 'partner' | 'company', row: unknown = { id: 'x' }) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const findMany = vi.fn().mockResolvedValue([row]);
  const update = vi.fn().mockResolvedValue({});
  return { prisma: { [model]: { findUnique, findMany, update } } as unknown as PrismaClient, findUnique, update, findMany };
}

const VALID = { legalName: 'ООО Тест', inn: '7707083893', bankAccount: '40702810400000000001' };

beforeEach(() => recordAuditMock.mockReset());

describe('организация (самообслуживание)', () => {
  it('чтение: любой активный участник своей организации; чужая/не тот role → forbidden', async () => {
    const { prisma } = fake('organization', { name: 'О' });
    expect((await getOrgRequisites(prisma, orgMember('member'), 'org-1')).ok).toBe(true);
    expect(await getOrgRequisites(prisma, orgMember('member', 'org-2'), 'org-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(await getOrgRequisites(prisma, adminSession(), 'org-1')).toEqual({ ok: false, error: 'forbidden' });
  });

  it('запись: только admin|leader организации; member → forbidden', async () => {
    const { prisma, update } = fake('organization');
    expect(await setOrgRequisites(prisma, orgMember('member'), 'org-1', VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect((await setOrgRequisites(prisma, orgMember('leader'), 'org-1', VALID)).ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('аудит маскирует счёт (только хвост) и не содержит полного номера', async () => {
    const { prisma } = fake('organization');
    await setOrgRequisites(prisma, orgMember('admin'), 'org-1', VALID);
    const audit = recordAuditMock.mock.calls[0]![1];
    expect(audit.action).toBe('requisites_changed');
    expect(audit.after.bankAccountTail).toBe('0001');
    expect(JSON.stringify(audit)).not.toContain('40702810400000000001');
  });

  it('валидация и P2002-дубль ИНН', async () => {
    const { prisma } = fake('organization');
    const bad = await setOrgRequisites(prisma, orgMember('admin'), 'org-1', { inn: '1' });
    expect(bad.ok).toBe(false);

    const dup = fake('organization');
    dup.update.mockRejectedValue(P2002);
    const r = await setOrgRequisites(dup.prisma, orgMember('admin'), 'org-1', VALID);
    expect(r).toEqual({ ok: false, error: 'validation', messages: ['Организация с таким ИНН уже существует'] });
  });

  it('not_found когда организации нет', async () => {
    const { prisma } = fake('organization', null);
    expect(await setOrgRequisites(prisma, orgMember('admin'), 'org-1', VALID)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('партнёр (самообслуживание)', () => {
  it('чтение — любой партнёрский пользователь; запись — только partner-admin', async () => {
    const { prisma, update } = fake('partner', { name: 'П' });
    expect((await getPartnerRequisites(prisma, partnerSession('manager'))).ok).toBe(true);
    expect(await setPartnerRequisites(prisma, partnerSession('manager'), VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect((await setPartnerRequisites(prisma, partnerSession('admin'), VALID)).ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pt-1' } }));
  });

  it('P2002 → русская валидация; клиентская организация → forbidden', async () => {
    const dup = fake('partner');
    dup.update.mockRejectedValue(P2002);
    expect(await setPartnerRequisites(dup.prisma, partnerSession('admin'), VALID)).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Партнёр с таким ИНН уже существует']
    });
    expect(await getPartnerRequisites(dup.prisma, orgMember('admin'))).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('компания (админ)', () => {
  it('список — только admin; запись валидирует email и пишет phone/email', async () => {
    const { prisma, update } = fake('company', { id: 'c1', name: 'К' });
    expect((await listCompaniesRequisites(prisma, adminSession())).ok).toBe(true);
    expect(await listCompaniesRequisites(prisma, partnerSession('admin'))).toEqual({ ok: false, error: 'forbidden' });

    const bad = await setCompanyRequisites(prisma, adminSession(), 'c1', { ...VALID, email: 'не-почта' });
    expect(bad.ok).toBe(false);

    const r = await setCompanyRequisites(prisma, adminSession(), 'c1', { ...VALID, phone: ' +7 495 000-00-00 ', email: 'Doc@X.RU ' });
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '+7 495 000-00-00', email: 'doc@x.ru' }) })
    );
  });

  it('не-admin → forbidden; not_found', async () => {
    const { prisma } = fake('company', null);
    expect(await setCompanyRequisites(prisma, orgMember('admin'), 'c1', VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(await setCompanyRequisites(prisma, adminSession(), 'cX', VALID)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('админ-правка контрагентов', () => {
  it('гейт admin; успех пишет и аудирует; чтение не-админом → null', async () => {
    const { prisma, update } = fake('organization');
    expect(await setOrgRequisitesByAdmin(prisma, partnerSession('admin'), 'org-1', VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect((await setOrgRequisitesByAdmin(prisma, adminSession(), 'org-1', VALID)).ok).toBe(true);
    expect(update).toHaveBeenCalled();
    expect(await getOrgRequisitesByAdmin(prisma, partnerSession('admin'), 'org-1')).toBeNull();
  });

  it('партнёр: P2002 → валидация; not_found', async () => {
    const dup = fake('partner');
    dup.update.mockRejectedValue(P2002);
    expect(await setPartnerRequisitesByAdmin(dup.prisma, adminSession(), 'pt-1', VALID)).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Партнёр с таким ИНН уже существует']
    });
    const none = fake('partner', null);
    expect(await setPartnerRequisitesByAdmin(none.prisma, adminSession(), 'pt-X', VALID)).toEqual({ ok: false, error: 'not_found' });
  });
});
