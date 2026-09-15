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
// Доступность канала — серверный предикат (ключи ботов, флаги). В тесте им
// управляем вручную: иначе результат зависел бы от переменных окружения машины.
vi.mock('@/lib/services/messengers/availability', () => ({
  isMessengerAvailable: m.isMessengerAvailable,
}));

import { listDialogCandidates, startDialog } from '@/lib/services/messengers/start';
import { DIALOG_CHANNELS } from '@/lib/services/messengers/channels';

/**
 * «Написать первым с причиной» (`У-216`).
 *
 * Раньше недоступный канал просто исчезал из списка, и человек оставался без
 * ответа: кнопка «Написать» есть, Telegram в списке нет — почему? Две причины
 * выглядят одинаково, а лечатся по-разному: адреса нет — это к клиенту
 * («нажмите Старт в боте»), канал не подключён — к администратору. Поэтому
 * канал теперь приходит всегда, вместе с причиной.
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

/** Состояние канала в ответе — по имени канала. */
function chan(
  candidate: { channels: { channel: string; available: boolean; reason: string | null }[] },
  name: string
) {
  const found = candidate.channels.find((c) => c.channel === name);
  if (!found) throw new Error(`канал ${name} пропал из ответа`);
  return found;
}

describe('listDialogCandidates — причины недоступности (У-216)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    userFindMany.mockResolvedValue([]);
    contactFindMany.mockResolvedValue([]);
    // По умолчанию все каналы подключены — тогда единственная причина отказа
    // «адреса нет», и её видно отдельно от «канал выключен».
    m.isMessengerAvailable.mockReturnValue(true);
  });

  it('каждый кандидат несёт ВСЕ каналы диалога, а не только доступные', async () => {
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
    // Раньше список каналов был короче на недоступные — человек не понимал,
    // почему нужного канала нет вовсе.
    expect(candidate?.channels.map((c) => c.channel)).toEqual([...DIALOG_CHANNELS]);
  });

  it('адреса нет → причина зовёт к клиенту; для Telegram и MAX она особая', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'u1',
        name: 'Иван',
        email: 'i@t.test',
        telegramChatId: null,
        maxChatId: null,
        whatsappPhone: null,
        organization: { id: 'o1', name: 'Ромашка' },
      },
    ]);
    const [c] = await listDialogCandidates(prisma, managerSession());
    // Бот физически не может написать первым, пока человек не нажал «Старт» —
    // это правило мессенджера, а не наша настройка, и добавить адрес руками
    // нельзя. Поэтому формулировка другая, чем у WhatsApp и почты.
    expect(chan(c!, 'telegram')).toEqual({
      channel: 'telegram',
      available: false,
      reason: 'Человек не нажимал «Старт» в нашем боте Telegram — до этого написать ему нельзя.',
    });
    expect(chan(c!, 'max').reason).toContain('MAX');
    // «В карточке этого человека», а не «контакта»: в списке есть и
    // пользователи кабинета, у которых номер лежит в профиле.
    expect(chan(c!, 'whatsapp').reason).toBe(
      'Номер WhatsApp неизвестен — укажите его в карточке этого человека.'
    );
    // Почта у пользователя кабинета есть всегда — это его логин.
    expect(chan(c!, 'email')).toEqual({ channel: 'email', available: true, reason: null });
  });

  it('адрес есть, но канал выключен → причина зовёт к администратору', async () => {
    // Ровно та пара, которую прежний экран путал: адрес известен, а написать
    // нельзя — лечится настройкой интеграции, а не звонком клиенту.
    m.isMessengerAvailable.mockImplementation((ch: string) => ch !== 'telegram');
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
    const [c] = await listDialogCandidates(prisma, managerSession());
    expect(chan(c!, 'telegram')).toEqual({
      channel: 'telegram',
      available: false,
      reason: 'Канал не подключён в настройках — обратитесь к администратору.',
    });
    // Отсутствие адреса проверяется РАНЬШЕ выключенного канала: иначе человеку
    // сказали бы «обратитесь к администратору» там, где админ бессилен.
    expect(chan(c!, 'max').reason).toContain('«Старт»');
  });

  it('контакт: каналы по его записям, доступность — по подключению', async () => {
    m.isMessengerAvailable.mockImplementation((ch: string) => ch !== 'whatsapp');
    contactFindMany.mockResolvedValue([
      {
        id: 'k1',
        name: 'Контакт',
        organizationId: 'o1',
        organization: { name: 'Ромашка' },
        channels: [{ type: 'telegram' }, { type: 'whatsapp' }],
      },
    ]);
    const [c] = await listDialogCandidates(prisma, managerSession());
    expect(c).toMatchObject({
      kind: 'contact',
      id: 'k1',
      name: 'Контакт',
      organizationId: 'o1',
      organizationName: 'Ромашка',
    });
    expect(chan(c!, 'telegram').available).toBe(true);
    expect(chan(c!, 'whatsapp')).toMatchObject({
      available: false,
      reason: expect.stringContaining('администратору'),
    });
    expect(chan(c!, 'max').reason).toContain('«Старт»');
    expect(chan(c!, 'email').reason).toContain('Адрес почты неизвестен');
  });

  it('наружу не отдаются сами адреса — только «можно/нельзя» и причина (ПДн)', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'u1',
        name: 'Иван',
        email: 'ivan@t.test',
        telegramChatId: 'tg-secret-1',
        maxChatId: 'mx-secret-1',
        whatsappPhone: '+79990001122',
        organization: { id: 'o1', name: 'Ромашка' },
      },
    ]);
    contactFindMany.mockResolvedValue([
      {
        id: 'k1',
        name: 'Контакт',
        organizationId: null,
        organization: null,
        channels: [{ type: 'telegram' }],
      },
    ]);
    const out = await listDialogCandidates(prisma, managerSession());
    const dump = JSON.stringify(out);
    // Писать chatId и телефон в список кандидатов значило бы разложить ПДн по
    // экранам без всякой нужды: для кнопки «Написать» хватает id человека.
    for (const secret of ['tg-secret-1', 'mx-secret-1', '+79990001122', 'ivan@t.test']) {
      expect(dump).not.toContain(secret);
    }
    // И у канала ровно три поля — «лишнего» ключа с адресом нет.
    for (const c of out) {
      for (const ch of c.channels) {
        expect(Object.keys(ch).sort()).toEqual(['available', 'channel', 'reason']);
      }
    }
    // Служебная заглушка адреса контакта наружу тоже не уходит.
    expect(dump).not.toContain('known');
  });

  it('без фильтра организации: контакты — только с адресом, пользователи — все', async () => {
    await listDialogCandidates(prisma, managerSession());
    // У пользователя кабинета адрес почты есть ВСЕГДА — это его логин, а почта
    // с `У-205` полноценный канал диалога. Поэтому отбора «есть хоть один
    // адрес» у них нет: пока он стоял, сотрудник организации без бота выпадал
    // из списка, хотя написать ему было можно, — и соседняя ветка контактов
    // (она отбирает по `DIALOG_CHANNELS`, то есть с почтой) его бы показала.
    const userWhere = userFindMany.mock.calls[0]?.[0].where;
    expect(userWhere.organization).toEqual({ companyId: 'c1' });
    expect(userWhere.OR).toBeUndefined();
    expect(contactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'c1',
          isArchived: false,
          OR: [{ organizationId: null }, { organization: { companyId: 'c1' } }],
          channels: { some: { type: { in: [...DIALOG_CHANNELS] } } },
        }),
      })
    );
  });

  it('с фильтром организации: показываются ВСЕ её люди, даже недоступные', async () => {
    await listDialogCandidates(prisma, managerSession(), { organizationId: 'o1' });
    const userWhere = userFindMany.mock.calls[0]?.[0].where;
    // Человек пришёл с вопросом «как связаться с этой организацией» — пустой
    // список не ответ. Поэтому отбора по наличию адреса здесь нет...
    expect(userWhere).not.toHaveProperty('OR');
    // ...но охват сотрудника никуда не делся: сужение по организации ложится
    // ПОВЕРХ скоупа, а не вместо него.
    expect(userWhere.organization).toEqual({ AND: [{ companyId: 'c1' }, { id: 'o1' }] });
    const contactWhere = contactFindMany.mock.calls[0]?.[0].where;
    expect(contactWhere).not.toHaveProperty('channels');
    expect(contactWhere).toMatchObject({
      organizationId: 'o1',
      organization: { companyId: 'c1' },
      isArchived: false,
    });
  });

  it('командная видимость выключена: сужение по организации поверх закреплённых', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    await listDialogCandidates(prisma, managerSession(), { organizationId: 'o1' });
    expect(userFindMany.mock.calls[0]?.[0].where.organization).toEqual({
      AND: [{ id: { in: ['o1'] } }, { id: 'o1' }],
    });
  });

  it('сессия без компании → пусто, база не спрашивается', async () => {
    await expect(
      listDialogCandidates(prisma, managerSession({ companyId: null }))
    ).resolves.toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(m.recordPiiAccess).not.toHaveBeenCalled();
  });

  it('безымянный пользователь подписывается почтой; журнал ПДн заполнен', async () => {
    userFindMany.mockResolvedValue([
      {
        id: 'u2',
        name: '  ',
        email: 'p@t.test',
        telegramChatId: null,
        maxChatId: null,
        whatsappPhone: null,
        organization: null,
      },
    ]);
    contactFindMany.mockResolvedValue([
      { id: 'k2', name: 'Второй', organizationId: null, organization: null, channels: [] },
    ]);
    const out = await listDialogCandidates(prisma, managerSession());
    // Имя из пробелов — это «имени нет»: иначе в списке была бы пустая строка.
    expect(out[0]).toMatchObject({
      name: 'p@t.test',
      organizationId: null,
      organizationName: null,
    });
    expect(m.recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: managerSession(),
      context: 'messengers_candidates',
      subjectIds: ['u2', 'k2'],
    });
  });
});

describe('startDialog — почта как канал диалога (У-205, У-216)', () => {
  const user = {
    id: 'u1',
    name: 'Иван',
    email: '  IVAN@T.TEST ',
    telegramChatId: 'tg1',
    maxChatId: 'mx1',
    whatsappPhone: '+79990001122',
    organization: { id: 'o1', companyId: 'c1' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    m.upsertDialog.mockResolvedValue({ id: 'd1', companyId: 'c1' });
    userFindUnique.mockResolvedValue(user);
  });

  it('пользователю кабинета письмо уходит на его адрес, приведённый к обычному виду', async () => {
    await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'email' });
    // Адрес нормализуется так же, как хранится у контактов, — иначе диалог по
    // письму и диалог по карточке разошлись бы на разные `peerRef`.
    expect(m.upsertDialog).toHaveBeenLastCalledWith(
      prisma,
      { channel: 'email', peerRef: 'ivan@t.test' },
      expect.objectContaining({
        create: expect.objectContaining({
          peerDisplay: 'Иван',
          userId: 'u1',
          organizationId: 'o1',
        }),
      })
    );
  });

  it('почта НЕ подставляет номер WhatsApp — ловушка хвоста тернарника', async () => {
    // Каналы разбираются цепочкой `?:`, и почта в ней — ОТДЕЛЬНАЯ ветка. Если
    // её снова сделать «всем остальным», письмо уйдёт на телефон: адресом
    // станет `whatsappPhone`. Проверка именно на это.
    await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'email' });
    const [, key] = m.upsertDialog.mock.calls.at(-1) as [unknown, { peerRef: string }];
    expect(key.peerRef).not.toBe(user.whatsappPhone);
    expect(key.peerRef).not.toBe(user.telegramChatId);
    expect(key.peerRef).not.toBe(user.maxChatId);
    expect(key.peerRef).toContain('@');
  });

  it('у каждого мессенджера свой адрес — соседние каналы не подменяются', async () => {
    for (const [channel, peerRef] of [
      ['telegram', 'tg1'],
      ['max', 'mx1'],
      ['whatsapp', '+79990001122'],
    ] as const) {
      await startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel });
      expect(m.upsertDialog).toHaveBeenLastCalledWith(
        prisma,
        { channel, peerRef },
        expect.anything()
      );
    }
  });

  it('пустая почта пользователя → no_messenger_channel, а не письмо в никуда', async () => {
    userFindUnique.mockResolvedValueOnce({ ...user, email: '   ' });
    await expect(
      startDialog(prisma, managerSession(), { kind: 'user', id: 'u1', channel: 'email' })
    ).resolves.toEqual({ ok: false, error: 'no_messenger_channel' });
    expect(m.upsertDialog).not.toHaveBeenCalled();
  });

  it('контакту почта берётся из его канала типа email, а не из чужого канала', async () => {
    contactFindUnique.mockResolvedValue({
      id: 'k1',
      name: 'Контакт',
      companyId: 'c1',
      organizationId: 'o1',
      isArchived: false,
      channels: [{ normalizedValue: 'k@t.test' }],
    });
    const r = await startDialog(prisma, managerSession(), {
      kind: 'contact',
      id: 'k1',
      channel: 'email',
    });
    expect(r).toEqual({ ok: true, dialogId: 'd1' });
    // Выборка канала сужена типом: без этого `channels[0]` мог бы оказаться
    // телефоном, и письмо ушло бы на номер.
    expect(contactFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          channels: { where: { type: 'email' }, select: { normalizedValue: true }, take: 1 },
        }),
      })
    );
    expect(m.upsertDialog).toHaveBeenLastCalledWith(
      prisma,
      { channel: 'email', peerRef: 'k@t.test' },
      expect.anything()
    );
    expect(m.recordAudit).toHaveBeenLastCalledWith(prisma, {
      action: 'messenger_dialog_started',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'm1',
      after: { channel: 'email', kind: 'contact', targetId: 'k1' },
    });
  });
});
