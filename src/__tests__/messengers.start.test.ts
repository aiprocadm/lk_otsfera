import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  recordAudit: vi.fn(),
  recordPiiAccess: vi.fn(),
  upsertDialog: vi.fn(),
  isMessengerAvailable: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth/managerPolicy')>('@/lib/auth/managerPolicy')),
  getCompanyTeamVisibility: m.getCompanyTeamVisibility,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess: m.recordPiiAccess }));
vi.mock('@/lib/services/messengers/dialog', () => ({ upsertDialog: m.upsertDialog }));
// `У-216`: «подключён ли канал» решают ключи ботов и настройки почты — в unit
// это внешний мир. Мокаем, иначе результат теста зависел бы от env машины.
vi.mock('@/lib/services/messengers/availability', () => ({
  isMessengerAvailable: m.isMessengerAvailable,
}));

import { listDialogCandidates, startDialog } from '@/lib/services/messengers/start';

/**
 * «Новый диалог» (спека 2026-09-12, Р-М-8): кандидаты в охвате сотрудника,
 * адрес берётся с сервера, чужой диалог не открывается.
 *
 * С `У-216` кандидат несёт ВСЕ каналы диалога сразу — каждый со своим
 * «можно/нельзя» и причиной. Раньше недоступный канал просто выпадал из
 * списка, и человек не мог понять, почему Telegram есть у одного клиента и
 * нет у другого.
 */
const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const contactFindMany = vi.fn();
const contactFindUnique = vi.fn();
const dialogUpdateMany = vi.fn();
const prisma = {
  user: { findMany: userFindMany, findUnique: userFindUnique },
  contact: { findMany: contactFindMany, findUnique: contactFindUnique },
  messengerDialog: { updateMany: dialogUpdateMany },
} as unknown as PrismaClient;

function managerSession(opts: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'm1',
    role: 'manager',
    companyId: 'c1',
    managedOrgIds: ['o1'],
    ...opts,
  } as SessionPayload;
}

describe('listDialogCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    // По умолчанию все каналы подключены: тогда «нельзя» означает ровно одно —
    // адреса не знаем, и причина в ответе будет про адрес, а не про настройки.
    m.isMessengerAvailable.mockReturnValue(true);
    userFindMany.mockResolvedValue([]);
    contactFindMany.mockResolvedValue([]);
  });

  it('сессия без компании → пусто, база не спрашивается', async () => {
    await expect(
      listDialogCandidates(prisma, managerSession({ companyId: null }))
    ).resolves.toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('пользователи кабинетов и контакты, в охвате компании; у каждого — все каналы со своим «можно/нельзя»', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'u1',
        name: '  Иван ',
        email: 'i@t.test',
        telegramChatId: 'tg1',
        maxChatId: null,
        whatsappPhone: null,
        organization: { id: 'o1', name: 'Ромашка' },
      },
      {
        id: 'u2',
        name: '',
        email: 'p@t.test',
        telegramChatId: null,
        maxChatId: 'mx2',
        whatsappPhone: '+79990001122',
        organization: null,
      },
    ]);
    contactFindMany.mockResolvedValue([
      {
        id: 'k1',
        name: 'Контакт',
        organizationId: null,
        organization: null,
        channels: [{ type: 'telegram' }, { type: 'telegram' }, { type: 'whatsapp' }],
      },
      {
        id: 'k2',
        name: 'Второй',
        organizationId: 'o2',
        organization: { name: 'Лютик' },
        channels: [{ type: 'max' }],
      },
    ]);
    const r = await listDialogCandidates(prisma, managerSession());

    const ok = { available: true, reason: null };
    const noAddress = (reason: string) => ({ available: false, reason });
    const NO_TG =
      'Человек не нажимал «Старт» в нашем боте Telegram — до этого написать ему нельзя.';
    const NO_MAX = 'Человек не нажимал «Старт» в нашем боте MAX — до этого написать ему нельзя.';
    const NO_WA = 'Номер WhatsApp неизвестен — укажите его в карточке этого человека.';
    const NO_MAIL = 'Адрес почты неизвестен — укажите его в карточке этого человека.';

    expect(r).toEqual([
      {
        kind: 'user',
        id: 'u1',
        name: 'Иван',
        organizationId: 'o1',
        organizationName: 'Ромашка',
        // У пользователя кабинета почта есть всегда — это его логин, поэтому
        // написать ему можно как минимум письмом.
        channels: [
          { channel: 'telegram', ...ok },
          { channel: 'max', ...noAddress(NO_MAX) },
          { channel: 'whatsapp', ...noAddress(NO_WA) },
          { channel: 'email', ...ok },
        ],
      },
      {
        kind: 'user',
        id: 'u2',
        name: 'p@t.test',
        organizationId: null,
        organizationName: null,
        channels: [
          { channel: 'telegram', ...noAddress(NO_TG) },
          { channel: 'max', ...ok },
          { channel: 'whatsapp', ...ok },
          { channel: 'email', ...ok },
        ],
      },
      {
        kind: 'contact',
        id: 'k1',
        name: 'Контакт',
        organizationId: null,
        organizationName: null,
        // Два одинаковых канала в карточке — один пункт в списке: выбирают
        // способ связи, а не конкретную запись.
        channels: [
          { channel: 'telegram', ...ok },
          { channel: 'max', ...noAddress(NO_MAX) },
          { channel: 'whatsapp', ...ok },
          { channel: 'email', ...noAddress(NO_MAIL) },
        ],
      },
      {
        kind: 'contact',
        id: 'k2',
        name: 'Второй',
        organizationId: 'o2',
        organizationName: 'Лютик',
        channels: [
          { channel: 'telegram', ...noAddress(NO_TG) },
          { channel: 'max', ...ok },
          { channel: 'whatsapp', ...noAddress(NO_WA) },
          { channel: 'email', ...noAddress(NO_MAIL) },
        ],
      },
    ]);
    // Наружу уходит только «можно/нельзя»: ни chatId, ни номера, ни почты в
    // списке кандидатов нет — иначе ПДн разъехались бы по экранам без нужды.
    expect(JSON.stringify(r)).not.toContain('tg1');
    expect(JSON.stringify(r)).not.toContain('+79990001122');
    // Командная видимость включена → охват = вся компания.
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: 'organization',
          isActive: true,
          organization: { companyId: 'c1' },
        }),
      })
    );
    expect(contactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'c1',
          isArchived: false,
          OR: [{ organizationId: null }, { organization: { companyId: 'c1' } }],
        }),
      })
    );
    expect(m.recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: managerSession(),
      context: 'messengers_candidates',
      subjectIds: ['u1', 'u2', 'k1', 'k2'],
    });
  });

  it('`У-216`: адрес известен, но канал выключен → причина зовёт к администратору, а не к клиенту', async () => {
    // Две причины выглядят одинаково («написать нельзя»), а лечатся по-разному:
    // неизвестный адрес — это к клиенту, выключенный канал — к администратору.
    // Если перепутать, человек пойдёт не туда и вернётся ни с чем.
    m.isMessengerAvailable.mockReturnValue(false);
    userFindMany.mockResolvedValue([
      {
        id: 'u1',
        name: 'Иван',
        email: 'i@t.test',
        telegramChatId: 'tg1',
        maxChatId: null,
        whatsappPhone: null,
        organization: { id: 'o1', name: 'Ромашка' },
      },
    ]);
    const [candidate] = await listDialogCandidates(prisma, managerSession());
    const byChannel = new Map(candidate!.channels.map((c) => [c.channel, c]));
    expect(byChannel.get('telegram')).toEqual({
      channel: 'telegram',
      available: false,
      reason: 'Канал не подключён в настройках — обратитесь к администратору.',
    });
    // А там, где адреса и так нет, причина остаётся прежней — про адрес, и
    // ведёт в карточку человека, а не в настройки интеграции.
    expect(byChannel.get('whatsapp')?.reason).toContain('карточке');
    expect(byChannel.get('whatsapp')?.reason).not.toContain('администратору');
  });

  it('командная видимость выключена → охват по закреплённым организациям', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    await listDialogCandidates(prisma, managerSession());
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organization: { id: { in: ['o1'] } } }),
      })
    );
  });
});

describe('startDialog', () => {
  const user = {
    id: 'u1',
    name: 'Иван',
    email: 'i@t.test',
    telegramChatId: 'tg1',
    maxChatId: 'mx1',
    whatsappPhone: '+79990001122',
    organization: { id: 'o1', companyId: 'c1' },
  };
  const contact = {
    id: 'k1',
    name: 'Контакт',
    companyId: 'c1',
    organizationId: null,
    isArchived: false,
    channels: [{ normalizedValue: '+79990001122' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    m.upsertDialog.mockResolvedValue({ id: 'd1', companyId: 'c1' });
    userFindUnique.mockResolvedValue(user);
    contactFindUnique.mockResolvedValue(contact);
  });

  it('сессия без компании → forbidden', async () => {
    await expect(
      startDialog(prisma, managerSession({ companyId: null }), {
        kind: 'user',
        id: 'u1',
        channel: 'telegram',
      })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('пользователь: не найден → not_found; без организации или чужой компании → forbidden', async () => {
    userFindUnique.mockResolvedValueOnce(null);
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'x', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    userFindUnique.mockResolvedValueOnce({ ...user, organization: null });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    userFindUnique.mockResolvedValueOnce({ ...user, organization: { id: 'o1', companyId: 'x' } });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('командная видимость выключена: незакреплённая организация → forbidden, руководителю можно', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    await expect(
      startDialog(prisma, managerSession({ managedOrgIds: ['o9'] }), {
        kind: 'user',
        id: 'u1',
        channel: 'telegram',
      })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(
      startDialog(prisma, managerSession({ role: 'leader', managedOrgIds: [] }), {
        kind: 'user',
        id: 'u1',
        channel: 'telegram',
      })
    ).resolves.toEqual({ ok: true, dialogId: 'd1' });
  });

  it('пользователь: адрес по мессенджеру с сервера; нет адреса → no_messenger_channel', async () => {
    await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'max' });
    expect(m.upsertDialog).toHaveBeenLastCalledWith(
      prisma,
      { channel: 'max', peerRef: 'mx1' },
      {
        create: {
          peerDisplay: 'Иван',
          companyId: 'c1',
          organizationId: 'o1',
          contactId: null,
          userId: 'u1',
          status: 'open',
          unreadCount: 0,
        },
        update: {},
      }
    );
    await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'whatsapp' });
    expect(m.upsertDialog).toHaveBeenLastCalledWith(
      prisma,
      { channel: 'whatsapp', peerRef: '+79990001122' },
      expect.anything()
    );
    userFindUnique.mockResolvedValueOnce({ ...user, name: null, telegramChatId: null });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'no_messenger_channel' });

    // Без имени — подписывается почтой.
    userFindUnique.mockResolvedValueOnce({ ...user, name: '  ' });
    await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'telegram' });
    expect(m.upsertDialog).toHaveBeenLastCalledWith(
      prisma,
      { channel: 'telegram', peerRef: 'tg1' },
      expect.objectContaining({ create: expect.objectContaining({ peerDisplay: 'i@t.test' }) })
    );
    expect(m.recordAudit).toHaveBeenLastCalledWith(prisma, {
      action: 'messenger_dialog_started',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'm1',
      after: { channel: 'telegram', kind: 'user', targetId: 'u1' },
    });
  });

  it('контакт: не найден / в архиве → not_found; чужой компании → forbidden; нет канала → no_messenger_channel', async () => {
    contactFindUnique.mockResolvedValueOnce(null);
    await expect(
      startDialog(prisma, managerSession(), { kind: 'contact', id: 'x', channel: 'whatsapp' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    contactFindUnique.mockResolvedValueOnce({ ...contact, isArchived: true });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'contact', id: 'k1', channel: 'whatsapp' })
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    contactFindUnique.mockResolvedValueOnce({ ...contact, companyId: 'other' });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'contact', id: 'k1', channel: 'whatsapp' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    contactFindUnique.mockResolvedValueOnce({ ...contact, channels: [] });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'contact', id: 'k1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'no_messenger_channel' });
    expect(contactFindUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          channels: { where: { type: 'telegram' }, select: { normalizedValue: true }, take: 1 },
        }),
      })
    );
  });

  it('контакт своей организации вне охвата → forbidden (командная видимость выключена)', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    contactFindUnique.mockResolvedValueOnce({ ...contact, organizationId: 'o9' });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'contact', id: 'k1', channel: 'whatsapp' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('контакт: диалог заводится с привязкой к контакту; ничей существующий — привязывается', async () => {
    m.upsertDialog.mockResolvedValueOnce({ id: 'd7', companyId: null });
    const r = await startDialog(prisma, managerSession(), {
      kind: 'contact',
      id: 'k1',
      channel: 'whatsapp',
    });
    expect(r).toEqual({ ok: true, dialogId: 'd7' });
    expect(m.upsertDialog).toHaveBeenCalledWith(
      prisma,
      { channel: 'whatsapp', peerRef: '+79990001122' },
      expect.objectContaining({
        create: expect.objectContaining({
          peerDisplay: 'Контакт',
          companyId: 'c1',
          organizationId: null,
          contactId: 'k1',
          userId: null,
        }),
      })
    );
    expect(dialogUpdateMany).toHaveBeenCalledWith({
      where: { id: 'd7', companyId: null },
      data: { companyId: 'c1', organizationId: null, contactId: 'k1', userId: null },
    });
  });

  it('существующий диалог чужой компании → forbidden, без аудита', async () => {
    m.upsertDialog.mockResolvedValueOnce({ id: 'd8', companyId: 'other' });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(dialogUpdateMany).not.toHaveBeenCalled();
    expect(m.recordAudit).not.toHaveBeenCalled();
  });
});
