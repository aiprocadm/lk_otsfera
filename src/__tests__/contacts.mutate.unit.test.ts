import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  addChannel,
  archiveContact,
  removeChannel,
  restoreContact,
  setPrimaryChannel,
  updateContact,
} from '@/lib/services/contacts/mutate';

/**
 * Правки контакта (этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.4):
 * каждая мутация — право → скоуп → проверка → запись → аудит; чужой и
 * несуществующий контакт неразличимы (`not_found`); занятый канал — подсказка
 * с владельцем (`contact_channel_taken`), в том числе при гонке `P2002`;
 * канал пользователя кабинета удалить нельзя (`contact_channel_locked`);
 * основной канал не исчезает вместе с удалённым.
 */
const contactFindUnique = vi.fn();
const contactUpdate = vi.fn();
const orgFindUnique = vi.fn();
const chFindFirst = vi.fn();
const chFindUnique = vi.fn();
const chCount = vi.fn();
const chCreate = vi.fn();
const chUpdateMany = vi.fn();
const chUpdate = vi.fn();
const chDelete = vi.fn();
const transaction = vi.fn();
const prisma = {
  contact: { findUnique: contactFindUnique, update: contactUpdate },
  organization: { findUnique: orgFindUnique },
  contactChannel: {
    findFirst: chFindFirst,
    findUnique: chFindUnique,
    count: chCount,
    create: chCreate,
    updateMany: chUpdateMany,
    update: chUpdate,
    delete: chDelete,
  },
  $transaction: transaction,
} as unknown as PrismaClient;

const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const manager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const contact = {
  id: 'k1',
  companyId: 'c1',
  organizationId: 'o1',
  userId: null,
  isArchived: false,
  mergedIntoId: null,
  name: 'Иван',
  user: null,
};
const cabinetUser = {
  email: 'ivan@test.ru',
  telegramChatId: 'tg-1',
  maxChatId: null,
  whatsappPhone: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  contactFindUnique.mockResolvedValue(contact);
  // Колбэк — с тем же объектом моков вместо tx; массив — просто дождаться.
  transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[])
  );
});

describe('updateContact', () => {
  it('клиентская роль → forbidden; нет контакта или чужая компания → not_found', async () => {
    await expect(updateContact(prisma, partner, true, { id: 'k1', name: 'Иван' })).resolves.toEqual(
      { ok: false, error: 'forbidden' }
    );
    expect(contactFindUnique).not.toHaveBeenCalled();

    contactFindUnique.mockResolvedValueOnce(null);
    await expect(updateContact(prisma, admin, true, { id: 'x', name: 'Иван' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    contactFindUnique.mockResolvedValueOnce({ ...contact, companyId: 'other' });
    await expect(updateContact(prisma, admin, true, { id: 'k1', name: 'Иван' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('пустое имя → invalid без записи', async () => {
    await expect(updateContact(prisma, admin, true, { id: 'k1', name: '   ' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('только имя: организация остаётся прежней, должность и заметка не трогаются, аудит с before/after', async () => {
    await expect(
      updateContact(prisma, admin, true, { id: 'k1', name: ' Иван Петров ' })
    ).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { name: 'Иван Петров', organizationId: 'o1' },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_updated',
      entity: 'contact',
      entityId: 'k1',
      userId: 'a1',
      before: { name: 'Иван', organizationId: 'o1' },
      after: { name: 'Иван Петров', organizationId: 'o1' },
    });
  });

  it('должность и заметка: обрезаются, пустые и null становятся null', async () => {
    await updateContact(prisma, admin, true, {
      id: 'k1',
      name: 'Иван',
      position: '  Директор ',
      note: '',
    });
    expect(contactUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 'Директор', note: null }),
      })
    );
    await updateContact(prisma, admin, true, {
      id: 'k1',
      name: 'Иван',
      position: null,
      note: null,
    });
    expect(contactUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: null, note: null }) })
    );
  });

  it('та же организация или отвязка (null) — без проверки организации', async () => {
    await updateContact(prisma, admin, true, { id: 'k1', name: 'Иван', organizationId: 'o1' });
    await updateContact(prisma, admin, true, { id: 'k1', name: 'Иван', organizationId: null });
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenLastCalledWith({
      where: { id: 'k1' },
      data: { name: 'Иван', organizationId: null },
    });
  });

  it('смена организации: нет такой / чужой компании / вне охвата менеджера → not_found', async () => {
    orgFindUnique.mockResolvedValueOnce(null);
    await expect(
      updateContact(prisma, admin, true, { id: 'k1', name: 'Иван', organizationId: 'o2' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    orgFindUnique.mockResolvedValueOnce({ id: 'o2', companyId: 'other' });
    await expect(
      updateContact(prisma, admin, true, { id: 'k1', name: 'Иван', organizationId: 'o2' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    // Команда выключена, o2 не закреплена за менеджером.
    orgFindUnique.mockResolvedValueOnce({ id: 'o2', companyId: 'c1' });
    await expect(
      updateContact(prisma, manager, false, { id: 'k1', name: 'Иван', organizationId: 'o2' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(orgFindUnique).toHaveBeenCalledWith({
      where: { id: 'o2' },
      select: { id: true, companyId: true },
    });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('смена организации в охвате (команда включена) — записывается', async () => {
    orgFindUnique.mockResolvedValueOnce({ id: 'o2', companyId: 'c1' });
    await expect(
      updateContact(prisma, manager, true, { id: 'k1', name: 'Иван', organizationId: 'o2' })
    ).resolves.toEqual({ ok: true, contactId: 'k1' });
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { name: 'Иван', organizationId: 'o2' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: 'm1', after: { name: 'Иван', organizationId: 'o2' } })
    );
  });
});

describe('archiveContact / restoreContact', () => {
  it('клиентская роль → forbidden; нет контакта → not_found', async () => {
    await expect(archiveContact(prisma, partner, true, { id: 'k1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(restoreContact(prisma, partner, true, { id: 'k1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    contactFindUnique.mockResolvedValueOnce(null);
    await expect(archiveContact(prisma, admin, true, { id: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    contactFindUnique.mockResolvedValueOnce({ ...contact, companyId: 'other' });
    await expect(restoreContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it('в архив: активный — запись и аудит; уже в архиве — ничего не меняем', async () => {
    await expect(archiveContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(contactUpdate).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { isArchived: true } });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_archived',
      entity: 'contact',
      entityId: 'k1',
      userId: 'a1',
    });

    vi.clearAllMocks();
    contactFindUnique.mockResolvedValueOnce({ ...contact, isArchived: true });
    await expect(archiveContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('из архива: объединённый → invalid; архивный — запись и аудит; активный — ничего', async () => {
    contactFindUnique.mockResolvedValueOnce({ ...contact, isArchived: true, mergedIntoId: 'k9' });
    await expect(restoreContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(contactUpdate).not.toHaveBeenCalled();

    contactFindUnique.mockResolvedValueOnce({ ...contact, isArchived: true });
    await expect(restoreContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { isArchived: false },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_restored',
      entity: 'contact',
      entityId: 'k1',
      userId: 'a1',
    });

    vi.clearAllMocks();
    contactFindUnique.mockResolvedValueOnce(contact);
    await expect(restoreContact(prisma, admin, true, { id: 'k1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('addChannel', () => {
  const args = { contactId: 'k1', type: 'phone', value: ' 8 (921) 123-45-67 ' } as const;

  beforeEach(() => {
    chFindFirst.mockResolvedValue(null);
    chCount.mockResolvedValue(0);
  });

  it('клиентская роль → forbidden; нет контакта → not_found; пустое значение → invalid', async () => {
    await expect(addChannel(prisma, partner, true, args)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    contactFindUnique.mockResolvedValueOnce(null);
    await expect(addChannel(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(
      addChannel(prisma, admin, true, { contactId: 'k1', type: 'phone', value: 'abc' })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(chFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('канал уже у этого же контакта — ok без записи; у другого — подсказка с владельцем', async () => {
    chFindFirst.mockResolvedValueOnce({ contactId: 'k1', contact: { name: 'Иван' } });
    await expect(addChannel(prisma, admin, true, args)).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(chFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1', type: 'phone', normalizedValue: '+79211234567' },
      })
    );
    chFindFirst.mockResolvedValueOnce({ contactId: 'k2', contact: { name: 'Петров П.П.' } });
    await expect(addChannel(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров П.П.' },
    });
    expect(chCount).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('первый канал становится основным: прежние снимаются, запись и аудит внутри транзакции', async () => {
    await expect(addChannel(prisma, manager, true, args)).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(chCount).toHaveBeenCalledWith({ where: { contactId: 'k1' } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(chUpdateMany).toHaveBeenCalledWith({
      where: { contactId: 'k1', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(chCreate).toHaveBeenCalledWith({
      data: {
        contactId: 'k1',
        companyId: 'c1',
        type: 'phone',
        value: '8 (921) 123-45-67',
        normalizedValue: '+79211234567',
        isPrimary: true,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_channel_added',
      entity: 'contact',
      entityId: 'k1',
      userId: 'm1',
      after: { type: 'phone' },
    });
  });

  it('у контакта уже есть каналы: новый не основной, если не просили; makePrimary — основной', async () => {
    chCount.mockResolvedValue(2);
    await addChannel(prisma, admin, true, {
      contactId: 'k1',
      type: 'email',
      value: ' New@Test.ru ',
    });
    expect(chUpdateMany).not.toHaveBeenCalled();
    expect(chCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'email',
        value: 'New@Test.ru',
        normalizedValue: 'new@test.ru',
        isPrimary: false,
      }),
    });

    await addChannel(prisma, admin, true, { ...args, makePrimary: true });
    expect(chUpdateMany).toHaveBeenCalledTimes(1);
    expect(chCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ isPrimary: true }),
    });
  });

  it('гонка: P2002 при записи, владелец нашёлся → та же подсказка, а не ошибка базы', async () => {
    chCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
    );
    chFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contactId: 'k2', contact: { name: 'Петров' } });
    await expect(addChannel(prisma, admin, true, args)).resolves.toEqual({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров' },
    });
    expect(chFindFirst).toHaveBeenCalledTimes(2);
  });

  it('P2002 без владельца, другой код Prisma и обычная ошибка — пробрасываются как есть', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    chCreate.mockRejectedValueOnce(dup);
    await expect(addChannel(prisma, admin, true, args)).rejects.toBe(dup);
    expect(chFindFirst).toHaveBeenCalledTimes(2);

    const other = new Prisma.PrismaClientKnownRequestError('gone', {
      code: 'P2025',
      clientVersion: 'x',
    });
    chCreate.mockRejectedValueOnce(other);
    await expect(addChannel(prisma, admin, true, args)).rejects.toBe(other);

    const plain = new Error('db down');
    chCreate.mockRejectedValueOnce(plain);
    await expect(addChannel(prisma, admin, true, args)).rejects.toBe(plain);
    // Повторный поиск владельца — только для P2002.
    expect(chFindFirst).toHaveBeenCalledTimes(4);
  });
});

describe('removeChannel', () => {
  const channel = {
    id: 'ch1',
    contactId: 'k1',
    type: 'email',
    normalizedValue: 'other@test.ru',
    isPrimary: true,
  };

  beforeEach(() => {
    chFindUnique.mockResolvedValue(channel);
    chFindFirst.mockResolvedValue(null);
  });

  it('клиентская роль → forbidden; нет канала или его контакт вне скоупа → not_found', async () => {
    await expect(removeChannel(prisma, partner, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(chFindUnique).not.toHaveBeenCalled();

    chFindUnique.mockResolvedValueOnce(null);
    await expect(removeChannel(prisma, admin, true, { channelId: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(contactFindUnique).not.toHaveBeenCalled();

    contactFindUnique.mockResolvedValueOnce({ ...contact, companyId: 'other' });
    await expect(removeChannel(prisma, admin, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(contactFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'k1' } })
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('канал пользователя кабинета → contact_channel_locked, ничего не удаляется', async () => {
    contactFindUnique.mockResolvedValueOnce({ ...contact, userId: 'u1', user: cabinetUser });
    chFindUnique.mockResolvedValueOnce({ ...channel, normalizedValue: 'ivan@test.ru' });
    await expect(removeChannel(prisma, admin, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: false,
      error: 'contact_channel_locked',
    });
    expect(chDelete).not.toHaveBeenCalled();
  });

  it('удаляем основной: следующий по порядку становится основным; аудит с типом', async () => {
    chFindFirst.mockResolvedValueOnce({ id: 'ch2' });
    await expect(removeChannel(prisma, admin, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(chDelete).toHaveBeenCalledWith({ where: { id: 'ch1' } });
    expect(chFindFirst).toHaveBeenCalledWith({
      where: { contactId: 'k1' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(chUpdate).toHaveBeenCalledWith({ where: { id: 'ch2' }, data: { isPrimary: true } });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'contact_channel_removed',
      entity: 'contact',
      entityId: 'k1',
      userId: 'a1',
      before: { type: 'email' },
    });
  });

  it('удалили последний основной — назначать некого; не основной — очередь не ищется', async () => {
    await removeChannel(prisma, admin, true, { channelId: 'ch1' });
    expect(chFindFirst).toHaveBeenCalledTimes(1);
    expect(chUpdate).not.toHaveBeenCalled();

    chFindUnique.mockResolvedValueOnce({ ...channel, isPrimary: false });
    await removeChannel(prisma, admin, true, { channelId: 'ch1' });
    expect(chFindFirst).toHaveBeenCalledTimes(1);
    expect(chDelete).toHaveBeenCalledTimes(2);
  });
});

describe('setPrimaryChannel', () => {
  const channel = {
    id: 'ch1',
    contactId: 'k1',
    type: 'email',
    normalizedValue: 'other@test.ru',
    isPrimary: false,
  };

  beforeEach(() => chFindUnique.mockResolvedValue(channel));

  it('клиентская роль → forbidden; нет канала → not_found', async () => {
    await expect(setPrimaryChannel(prisma, partner, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    chFindUnique.mockResolvedValueOnce(null);
    await expect(setPrimaryChannel(prisma, admin, true, { channelId: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('уже основной — ничего не пишем; иначе одной транзакцией снимаем прежний и ставим новый', async () => {
    chFindUnique.mockResolvedValueOnce({ ...channel, isPrimary: true });
    await expect(setPrimaryChannel(prisma, admin, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(transaction).not.toHaveBeenCalled();

    // Элементы массива — промисы Prisma-вызовов, как в бою.
    chUpdateMany.mockResolvedValueOnce({ count: 1 });
    chUpdate.mockResolvedValueOnce({ id: 'ch1' });
    await expect(setPrimaryChannel(prisma, manager, true, { channelId: 'ch1' })).resolves.toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(transaction).toHaveBeenCalledWith([expect.any(Promise), expect.any(Promise)]);
    expect(chUpdateMany).toHaveBeenCalledWith({
      where: { contactId: 'k1', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(chUpdate).toHaveBeenCalledWith({ where: { id: 'ch1' }, data: { isPrimary: true } });
  });
});
