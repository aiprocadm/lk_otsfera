import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { createLeadFromContact } from '@/lib/services/intake/convert';

/**
 * «Создать лид» из карточки контакта (этап 1 ТЗ 12.09.2026, `У-179`; спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.12):
 * только сотрудники ЦО; чужой и несуществующий контакт неразличимы
 * (`not_found`, скоуп — настоящий `isContactInScope`); поля лида подставляются
 * с контакта — компания это его организация, а без неё сам контакт; телефон и
 * почта — первые каналы своего типа; валидатор ручного лида отказывает контакту
 * без телефона и почты и пустой теме; источник `manual`, аудит с `contactId`.
 */
const findUnique = vi.fn();
const leadCreate = vi.fn();
const prisma = {
  contact: { findUnique },
  lead: { create: leadCreate },
} as unknown as PrismaClient;

const manager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'co-A',
  managedOrgIds: ['o1'],
} as SessionPayload;
const admin = { sub: 'a1', role: 'admin', companyId: 'co-A' } as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'co-A' } as SessionPayload;

const CONTACT = {
  id: 'k1',
  name: 'Иван Петров',
  companyId: 'co-A',
  organizationId: 'o1',
  isArchived: false,
  organization: { name: 'ООО Ромашка', inn: '7701234567' },
  channels: [
    { type: 'email', value: 'first@ex.ru' },
    { type: 'phone', value: '+79990000001' },
    { type: 'phone', value: '+79990000002' },
    { type: 'email', value: 'second@ex.ru' },
  ],
};

const LEAD = { id: 'lead-1' };

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(CONTACT);
  leadCreate.mockResolvedValue(LEAD);
});

describe('createLeadFromContact', () => {
  it('клиентская роль → forbidden без похода в базу', async () => {
    expect(
      await createLeadFromContact(prisma, partner, {
        contactId: 'k1',
        teamMode: true,
        input: { subject: 'Обучение' },
      })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('контакт не найден → not_found; читаются только нужные поля и каналы телефона/почты', async () => {
    findUnique.mockResolvedValue(null);
    expect(
      await createLeadFromContact(prisma, manager, {
        contactId: 'k9',
        teamMode: true,
        input: { subject: 'Обучение' },
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'k9' },
      select: expect.objectContaining({
        organization: { select: { name: true, inn: true } },
        channels: expect.objectContaining({
          where: { type: { in: ['phone', 'email'] } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        }),
      }),
    });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('контакт чужой компании → not_found (настоящий isContactInScope)', async () => {
    findUnique.mockResolvedValue({ ...CONTACT, companyId: 'co-B' });
    expect(
      await createLeadFromContact(prisma, manager, {
        contactId: 'k1',
        teamMode: true,
        input: { subject: 'Обучение' },
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('организация вне закреплений при teamMode=false → not_found, при teamMode=true — лид', async () => {
    findUnique.mockResolvedValue({ ...CONTACT, organizationId: 'o2' });
    expect(
      await createLeadFromContact(prisma, manager, {
        contactId: 'k1',
        teamMode: false,
        input: { subject: 'Обучение' },
      })
    ).toEqual({ ok: false, error: 'not_found' });
    const r = await createLeadFromContact(prisma, manager, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: 'Обучение' },
    });
    expect(r).toEqual({ ok: true, lead: LEAD });
  });

  it('архивный контакт → validation с подсказкой «верните из архива», лид не создаётся', async () => {
    findUnique.mockResolvedValue({ ...CONTACT, isArchived: true });
    const res = await createLeadFromContact(prisma, manager, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: 'Тема' },
    });
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Контакт в архиве — верните его из архива, чтобы создать лид'],
    });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('контакт без телефона и почты → validation с подсказкой, лид не создаётся', async () => {
    findUnique.mockResolvedValue({ ...CONTACT, channels: [] });
    const r = await createLeadFromContact(prisma, manager, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: 'Обучение' },
    });
    expect(r).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон или email для связи'],
    });
    expect(leadCreate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('пустая или отсутствующая тема → validation', async () => {
    expect(
      await createLeadFromContact(prisma, manager, {
        contactId: 'k1',
        teamMode: true,
        input: { subject: '   ' },
      })
    ).toEqual({ ok: false, error: 'validation', messages: ['Укажите тему обращения'] });
    expect(
      await createLeadFromContact(prisma, manager, { contactId: 'k1', teamMode: true, input: {} })
    ).toEqual({ ok: false, error: 'validation', messages: ['Укажите тему обращения'] });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('успех с организацией: компания и ИНН — организации, первые телефон и почта, источник manual, заметка обрезана; аудит', async () => {
    const r = await createLeadFromContact(prisma, manager, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: '  Обучение по ОТ  ', notes: '  перезвонить после обеда  ' },
    });
    expect(r).toEqual({ ok: true, lead: LEAD });
    expect(leadCreate).toHaveBeenCalledWith({
      data: {
        source: 'manual',
        organizationId: 'o1',
        createdByUserId: 'm1',
        clientCompanyName: 'ООО Ромашка',
        clientInn: '7701234567',
        clientContactName: 'Иван Петров',
        clientContactPhone: '+79990000001',
        clientContactEmail: 'first@ex.ru',
        subject: 'Обучение по ОТ',
        notes: 'перезвонить после обеда',
        status: 'new',
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm1',
      action: 'lead_created_from_contact',
      entity: 'lead',
      entityId: 'lead-1',
      after: { contactId: 'k1' },
    });
  });

  it('успех без организации: компанией лида становится сам контакт, ИНН и организация — null; заметка из пробелов → null', async () => {
    findUnique.mockResolvedValue({
      ...CONTACT,
      organizationId: null,
      organization: null,
      channels: [{ type: 'phone', value: '+79990000009' }],
    });
    const r = await createLeadFromContact(prisma, admin, {
      contactId: 'k1',
      teamMode: false,
      input: { subject: 'Обучение', notes: '   ' },
    });
    expect(r).toEqual({ ok: true, lead: LEAD });
    expect(leadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: null,
        createdByUserId: 'a1',
        clientCompanyName: 'Иван Петров',
        clientInn: null,
        clientContactPhone: '+79990000009',
        clientContactEmail: null,
        notes: null,
      }),
    });
  });

  it('только почта: телефон null, почта приводится к нижнему регистру; заметка не передана → null', async () => {
    findUnique.mockResolvedValue({
      ...CONTACT,
      organization: { name: 'ООО Ромашка', inn: null },
      channels: [{ type: 'email', value: 'Ivan@Ex.RU' }],
    });
    const r = await createLeadFromContact(prisma, manager, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: 'Обучение' },
    });
    expect(r.ok).toBe(true);
    expect(leadCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientInn: null,
        clientContactPhone: null,
        clientContactEmail: 'ivan@ex.ru',
        notes: null,
      }),
    });
  });
});
