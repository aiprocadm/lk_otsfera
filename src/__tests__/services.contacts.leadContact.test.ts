import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess, resolveContactByChannel } = vi.hoisted(() => ({
  recordPiiAccess: vi.fn(),
  resolveContactByChannel: vi.fn(),
}));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
vi.mock('@/lib/services/contacts/resolveContactByChannel', () => ({ resolveContactByChannel }));

import { findLeadContact } from '@/lib/services/contacts/leadContact';

/**
 * Контакт лида (этап 1 ТЗ 12.09.2026, `У-180`, спека 04 §«карточка лида»):
 * ищем по телефону заявки, потом по почте — тем же резолвером каналов, что
 * связывает звонки и письма. Совпадение принимается только в охвате сотрудника
 * (`isContactInScope` — настоящий, не мок): человек чужой компании или
 * незакреплённой организации на карточке лида — утечка. Найденный контакт —
 * событие ПДн `lead_contact_match`.
 */

const findUnique = vi.fn();
const prisma = { contact: { findUnique } } as unknown as PrismaClient;

const ADMIN = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const MANAGER = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const PARTNER = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;
const NO_COMPANY = { sub: 'm0', role: 'manager' } as SessionPayload;

const HIT = { contactId: 'k1', organizationId: 'o1', companyId: 'c1' };
const CONTACT = { id: 'k1', name: 'Иванов' };

const LEAD = { clientContactPhone: '+7 921 000-00-00', clientContactEmail: 'ivan@test.ru' };

beforeEach(() => {
  vi.clearAllMocks();
  resolveContactByChannel.mockResolvedValue(null);
  findUnique.mockResolvedValue(CONTACT);
});

describe('findLeadContact — право и пустые реквизиты', () => {
  it('без права на справочник — null, резолвер и база не вызываются', async () => {
    expect(await findLeadContact(prisma, PARTNER, true, LEAD)).toBeNull();
    expect(await findLeadContact(prisma, NO_COMPANY, true, LEAD)).toBeNull();
    expect(resolveContactByChannel).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('у лида ни телефона, ни почты — null без единого запроса', async () => {
    expect(
      await findLeadContact(prisma, ADMIN, true, {
        clientContactPhone: null,
        clientContactEmail: null,
      })
    ).toBeNull();
    expect(resolveContactByChannel).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});

describe('findLeadContact — порядок поиска', () => {
  it('телефон нашёлся — почта не проверяется; телефон ищется как «звонок» (phone + whatsapp)', async () => {
    resolveContactByChannel.mockResolvedValueOnce(HIT);
    expect(await findLeadContact(prisma, ADMIN, true, LEAD)).toEqual(CONTACT);
    expect(resolveContactByChannel).toHaveBeenCalledTimes(1);
    expect(resolveContactByChannel).toHaveBeenCalledWith(prisma, {
      type: 'phone',
      value: '+7 921 000-00-00',
      phoneLike: true,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'k1' },
      select: { id: true, name: true },
    });
    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: ADMIN,
      context: 'lead_contact_match',
      subjectIds: ['k1'],
    });
  });

  it('телефон не нашёлся — ищем по почте', async () => {
    resolveContactByChannel.mockResolvedValueOnce(null).mockResolvedValueOnce(HIT);
    expect(await findLeadContact(prisma, ADMIN, true, LEAD)).toEqual(CONTACT);
    expect(resolveContactByChannel).toHaveBeenCalledTimes(2);
    expect(resolveContactByChannel).toHaveBeenNthCalledWith(2, prisma, {
      type: 'email',
      value: 'ivan@test.ru',
    });
  });

  it('телефона нет — сразу по почте, одним вызовом', async () => {
    resolveContactByChannel.mockResolvedValueOnce(HIT);
    expect(
      await findLeadContact(prisma, ADMIN, true, { ...LEAD, clientContactPhone: null })
    ).toEqual(CONTACT);
    expect(resolveContactByChannel).toHaveBeenCalledTimes(1);
    expect(resolveContactByChannel).toHaveBeenCalledWith(prisma, {
      type: 'email',
      value: 'ivan@test.ru',
    });
  });

  it('телефон не нашёлся, почты нет — null после одного вызова, база не трогается', async () => {
    expect(
      await findLeadContact(prisma, ADMIN, true, { ...LEAD, clientContactEmail: null })
    ).toBeNull();
    expect(resolveContactByChannel).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ни телефон, ни почта не нашлись — null, база не трогается', async () => {
    expect(await findLeadContact(prisma, ADMIN, true, LEAD)).toBeNull();
    expect(resolveContactByChannel).toHaveBeenCalledTimes(2);
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});

describe('findLeadContact — охват сотрудника', () => {
  it('совпадение в чужой компании — null даже для администратора, карточка контакта не читается', async () => {
    resolveContactByChannel.mockResolvedValueOnce({ ...HIT, companyId: 'c2' });
    expect(await findLeadContact(prisma, ADMIN, true, LEAD)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('менеджер без команды: незакреплённая организация — null; с командой — контакт найден', async () => {
    const alienOrg = { ...HIT, organizationId: 'o2' };
    resolveContactByChannel.mockResolvedValueOnce(alienOrg);
    expect(await findLeadContact(prisma, MANAGER, false, LEAD)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();

    resolveContactByChannel.mockResolvedValueOnce(alienOrg);
    expect(await findLeadContact(prisma, MANAGER, true, LEAD)).toEqual(CONTACT);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: MANAGER,
      context: 'lead_contact_match',
      subjectIds: ['k1'],
    });
  });

  it('менеджер без команды: закреплённая организация и контакт «с улицы» — найдены', async () => {
    resolveContactByChannel.mockResolvedValueOnce(HIT);
    expect(await findLeadContact(prisma, MANAGER, false, LEAD)).toEqual(CONTACT);
    resolveContactByChannel.mockResolvedValueOnce({ ...HIT, organizationId: null });
    expect(await findLeadContact(prisma, MANAGER, false, LEAD)).toEqual(CONTACT);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('findLeadContact — контакт исчез между резолвером и чтением', () => {
  it('findUnique вернул null — null без события ПДн', async () => {
    resolveContactByChannel.mockResolvedValueOnce(HIT);
    findUnique.mockResolvedValue(null);
    expect(await findLeadContact(prisma, ADMIN, true, LEAD)).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});
