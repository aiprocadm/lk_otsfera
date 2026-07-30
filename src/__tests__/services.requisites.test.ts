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

  it('сессия вообще без членств и чужая роль → forbidden, БД не трогаем', async () => {
    const noMemberships = { sub: 'u1', role: 'organization' } as never;
    const { prisma, findUnique, update } = fake('organization');
    expect(await getOrgRequisites(prisma, noMemberships, 'org-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(await setOrgRequisites(prisma, adminSession(), 'org-1', VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('без банковского счёта в аудит уходит null, а не обрезок пустой строки', async () => {
    // В аудите хранится только хвост счёта. Если счёта нет вовсе, там должен
    // быть null — иначе в журнале появится пустая строка, похожая на данные.
    const { prisma } = fake('organization');
    await setOrgRequisites(prisma, orgMember('admin'), 'org-1', { legalName: 'ООО Тест', inn: '7707083893' });
    expect(recordAuditMock.mock.calls[0]![1].after.bankAccountTail).toBeNull();

    recordAuditMock.mockReset();
    const pt = fake('partner');
    await setPartnerRequisites(pt.prisma, partnerSession('admin'), { legalName: 'ООО Тест', inn: '7707083893' });
    expect(recordAuditMock.mock.calls[0]![1].after.bankAccountTail).toBeNull();
  });

  it('организация: чтение при отсутствии карточки → not_found; не-P2002 ошибка пробрасывается', async () => {
    const gone = fake('organization', null);
    expect(await getOrgRequisites(gone.prisma, orgMember('admin'), 'org-1')).toEqual({
      ok: false,
      error: 'not_found'
    });

    const broken = fake('organization');
    broken.update.mockRejectedValue(new Error('connection reset'));
    await expect(setOrgRequisites(broken.prisma, orgMember('admin'), 'org-1', VALID)).rejects.toThrow(
      'connection reset'
    );
  });

  it('членство неактивно → forbidden, будто организации нет', async () => {
    // Сотрудника отключили от организации, но сессия ещё жива. Он не должен
    // ни увидеть реквизиты, ни тем более их поменять.
    const inactive = {
      sub: 'u1',
      role: 'organization',
      organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: false }]
    } as never;
    const { prisma, findUnique, update } = fake('organization');
    expect(await getOrgRequisites(prisma, inactive, 'org-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(await setOrgRequisites(prisma, inactive, 'org-1', VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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

  it('партнёра нет в базе → not_found и при чтении, и при записи', async () => {
    // Партнёра могли удалить, пока сессия жива. Тогда сервис обязан честно
    // сказать «не найдено», а не создать реквизиты у несуществующего партнёра.
    const gone = fake('partner', null);
    expect(await getPartnerRequisites(gone.prisma, partnerSession('manager'))).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(await setPartnerRequisites(gone.prisma, partnerSession('admin'), VALID)).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(gone.update).not.toHaveBeenCalled();
  });

  it('кривые реквизиты партнёра → validation с причинами, запись не идёт', async () => {
    const { prisma, update } = fake('partner');
    const res = await setPartnerRequisites(prisma, partnerSession('admin'), { ...VALID, ogrn: '123' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('validation');
    expect(res.messages).toEqual(['ОГРН должен содержать 13 цифр (или 15 для ИП)']);
    expect(update).not.toHaveBeenCalled();
  });

  it('не-партнёрская роль и партнёр без partnerId → forbidden до запроса в БД', async () => {
    const { prisma, findUnique } = fake('partner');
    expect(await setPartnerRequisites(prisma, adminSession(), VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await getPartnerRequisites(prisma, { sub: 'u', role: 'partner' } as never)
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('не-P2002 ошибка базы пробрасывается наружу, а не маскируется валидацией', async () => {
    // Понятное сообщение мы придумываем только для дубля ИНН. Любая другая
    // ошибка базы должна дойти до логов и мониторинга, а не превратиться в
    // «проверьте реквизиты» — иначе сбой хранилища останется незамеченным.
    const broken = fake('partner');
    broken.update.mockRejectedValue(new Error('connection reset'));
    await expect(setPartnerRequisites(broken.prisma, partnerSession('admin'), VALID)).rejects.toThrow(
      'connection reset'
    );
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

  it('кривые реквизиты → validation с причинами; в базу ничего не пишем', async () => {
    // Реквизиты компании-исполнителя попадают в шапку документов, поэтому отказ
    // валидатора обязан останавливать запись, а не «дописывать как есть».
    const { prisma, update } = fake('company');
    const res = await setCompanyRequisites(prisma, adminSession(), 'c1', {
      ...VALID,
      inn: '123',
      kpp: '77'
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('validation');
    expect(res.messages).toEqual([
      'ИНН должен содержать 10 или 12 цифр',
      'КПП должен содержать 9 цифр'
    ]);
    expect(update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
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
