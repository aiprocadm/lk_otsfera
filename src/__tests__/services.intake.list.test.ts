/**
 * Этап 7 (ФТ-8.1/8.3/8.4) — ридер очереди «Входящие обращения»: критерии
 * источников, нормализация, сортировка, slaLevel, фильтры лидера, пагинация,
 * forbidden для клиентов; countIntake и getStaffBadges.
 *
 * Этап 7 ТЗ 13.10.2026 (`У-318`, `Р-7-6`): в очереди только внешние каналы —
 * сообщения мессенджеров и почты и звонки; фильтр по каналу; «Важное» —
 * первыми и отбор «Только важные». Обращения из кабинета и заявки на обучение
 * из очереди ушли в свои разделы.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

// ФТ-15.2: счётчик непрочитанной переписки берётся готовым сервисом чата.
const { unreadCount } = vi.hoisted(() => ({ unreadCount: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ unreadCount }));

// `У-215`: бейдж «Мессенджеров» считает ждущие ДИАЛОГИ (отдельный сервис).
const { countWaitingDialogs } = vi.hoisted(() => ({ countWaitingDialogs: vi.fn() }));
vi.mock('@/lib/services/messengers/list', () => ({ countWaitingDialogs }));

import {
  listIntake,
  countIntake,
  slaLevelFor,
  intakeCallWhere,
  intakeInboundWhere,
} from '@/lib/services/intake/list';
import { getStaffBadges } from '@/lib/services/intake/badges';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' }) as unknown as SessionPayload;

beforeEach(() => {
  unreadCount.mockResolvedValue({ ok: true, count: 3 });
  countWaitingDialogs.mockResolvedValue(4);
});

const H = 3_600_000;
const now = Date.now();
const ago = (hours: number) => new Date(now - hours * H);

function makePrisma(over: Record<string, unknown> = {}) {
  const base = {
    // PR-3: пороги подсветки читаются из компании; null → фолбэк-константы.
    company: { findUnique: vi.fn().mockResolvedValue(null) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    enrollmentRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    inboundMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    call: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    task: { count: vi.fn().mockResolvedValue(0) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    ...over,
  };
  return { prisma: base as unknown as PrismaClient, base };
}

function inboundRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    createdAt: ago(1),
    channel: 'email',
    senderDisplay: 'Пётр',
    senderRef: 'p@x.ru',
    subject: 'Вопрос',
    body: 'Текст обращения',
    claimedByUserId: null,
    resolvedOrgId: null,
    importantAt: null,
    ...over,
  };
}

function callRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    createdAt: ago(2),
    callerNumber: '+79990000000',
    durationSec: 30,
    status: 'answered',
    claimedByUserId: null,
    importantAt: null,
    ...over,
  };
}

beforeEach(() => recordPiiAccess.mockReset().mockResolvedValue(undefined));

describe('slaLevelFor и where-критерии', () => {
  it('пороги: ≤4ч ok, >4ч warning, >24ч breach', () => {
    expect(slaLevelFor(1 * H)).toBe('ok');
    expect(slaLevelFor(4 * H)).toBe('ok');
    expect(slaLevelFor(5 * H)).toBe('warning');
    expect(slaLevelFor(25 * H)).toBe('breach');
  });

  it('критерии: сообщения unresolved (вопрос из кабинета — тоже, ФТ-11.1), звонок без привязки/лида/закрытия', () => {
    const s = manager();
    expect(intakeInboundWhere(s)).toMatchObject({
      AND: [expect.anything(), { status: 'unresolved' }],
    });
    expect(intakeCallWhere(s)).toEqual({
      AND: [
        { OR: [{ companyId: 'co-A' }, { companyId: null }] },
        {
          direction: 'inbound',
          resolvedOrgId: null,
          contactId: null,
          intakeClosedAt: null,
          lead: null,
        },
      ],
    });
  });
});

describe('listIntake', () => {
  it('клиентская роль → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await listIntake(prisma, partner())).toEqual({ ok: false, error: 'forbidden' });
  });

  it('`У-318`: только сообщения и звонки — обращения из кабинета и заявки на обучение не читаются', async () => {
    const { prisma, base } = makePrisma({
      inboundMessage: { findMany: vi.fn().mockResolvedValue([inboundRow()]), count: vi.fn() },
      call: { findMany: vi.fn().mockResolvedValue([callRow()]), count: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(base.clientRequest.findMany).not.toHaveBeenCalled();
    expect(base.enrollmentRequest.findMany).not.toHaveBeenCalled();
    // Старейшее — первым: звонок (2ч), затем письмо (1ч).
    expect(res.result.items.map((i) => i.id)).toEqual(['c1', 'i1']);
    expect(res.result.items[0]).toMatchObject({
      type: 'call',
      channel: 'call',
      important: false,
      taskTitle: 'Перезвонить: +79990000000',
    });
    expect(res.result.items[0]!.leadPrefill).toMatchObject({ contactPhone: '+79990000000' });
    expect(res.result.items[1]).toMatchObject({ type: 'inbound', channel: 'email', from: 'Пётр' });
    expect(res.result.items[1]!.leadPrefill).toMatchObject({ contactEmail: 'p@x.ru' });
    expect(res.result.total).toBe(2);
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ context: 'intake_list', subjectIds: ['c1', 'i1'] })
    );
  });

  it('`У-318`: «Важное» — первым, внутри — самое залежавшееся', async () => {
    const { prisma } = makePrisma({
      inboundMessage: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            inboundRow({ id: 'old', createdAt: ago(10) }),
            inboundRow({ id: 'imp-new', createdAt: ago(1), importantAt: ago(0) }),
            inboundRow({ id: 'imp-old', createdAt: ago(3), importantAt: ago(0) }),
          ]),
        count: vi.fn(),
      },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items.map((i) => [i.id, i.important])).toEqual([
      ['imp-old', true],
      ['imp-new', true],
      ['old', false],
    ]);
  });

  it('`У-318`: фильтр по каналу — мессенджер: только сообщения этого канала, звонки не читаются', async () => {
    const { prisma, base } = makePrisma();
    await listIntake(prisma, manager(), { channel: 'telegram' });
    const where = (base.inboundMessage.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .where;
    expect(where.AND).toContainEqual({ channel: 'telegram' });
    expect(base.call.findMany).not.toHaveBeenCalled();
  });

  it('`У-318`: канал «Звонки» — только звонки; «Только важные» — отбор по пометке', async () => {
    const { prisma, base } = makePrisma();
    await listIntake(prisma, manager(), { channel: 'call', onlyImportant: true });
    expect(base.inboundMessage.findMany).not.toHaveBeenCalled();
    const where = (base.call.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(where.AND).toContainEqual({ importantAt: { not: null } });
  });

  it('без фильтров — ни отбора по каналу, ни по пометке', async () => {
    const { prisma, base } = makePrisma();
    await listIntake(prisma, manager());
    const where = (base.inboundMessage.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .where;
    expect(where.AND.slice(1)).toEqual([{}, {}]);
  });

  it('неполные данные подписываются читаемо', async () => {
    const { prisma } = makePrisma({
      inboundMessage: {
        findMany: vi.fn().mockResolvedValue([
          inboundRow({
            id: 'i-tg',
            createdAt: ago(3),
            channel: 'telegram',
            senderDisplay: '  ',
            senderRef: 'tg:123',
            subject: null,
            body: 'Длинный текст обращения без темы',
            claimedByUserId: 'ghost',
          }),
          inboundRow({
            id: 'i-sms',
            createdAt: ago(4),
            channel: 'sms',
            senderDisplay: 'Аноним',
            senderRef: 'sms:1',
            subject: '  ',
            body: 'Текст',
          }),
        ]),
        count: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) }, // имя ghost не нашлось
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const by = Object.fromEntries(res.result.items.map((i) => [i.id, i]));
    expect(by['i-tg']).toMatchObject({ from: 'tg:123' });
    expect(by['i-tg']!.essence).toBe('Telegram: Длинный текст обращения без темы');
    expect(by['i-tg']!.responsibleName).toBeNull();
    expect(by['i-tg']!.leadPrefill).toMatchObject({
      contactEmail: '',
      subject: 'Обращение из внешнего канала',
    });
    expect(by['i-sms']!.essence).toContain('sms:');
  });

  it('звонок без длительности (пропущенный) подписывается статусом', async () => {
    const { prisma } = makePrisma({
      call: {
        findMany: vi
          .fn()
          .mockResolvedValue([callRow({ id: 'c-missed', durationSec: null, status: 'missed' })]),
        count: vi.fn(),
      },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items[0]!.essence).toBe('Входящий звонок · missed');
  });

  it('сотрудник без компании: звонки — только общая корзина (companyId=null)', async () => {
    const calls = vi.fn().mockResolvedValue([]);
    const { prisma } = makePrisma({ call: { findMany: calls, count: vi.fn() } });
    const res = await listIntake(prisma, { ...manager(), companyId: undefined } as never);
    expect(res.ok).toBe(true);
    expect(JSON.stringify(calls.mock.calls[0][0].where)).toContain('__no_company__');
  });

  it('фильтры лидера: onlyUnassigned и assigneeId; имя ответственного подставляется', async () => {
    const { prisma } = makePrisma({
      inboundMessage: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            inboundRow({ id: 'i1', createdAt: ago(3), claimedByUserId: 'm2' }),
            inboundRow({ id: 'i2', createdAt: ago(2) }),
          ]),
        count: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'М' }]) },
    });
    const unassigned = await listIntake(prisma, manager(), { onlyUnassigned: true });
    expect(unassigned.ok && unassigned.result.items.map((i) => i.id)).toEqual(['i2']);
    const byAssignee = await listIntake(prisma, manager(), { assigneeId: 'm2' });
    expect(byAssignee.ok && byAssignee.result.items.map((i) => [i.id, i.responsibleName])).toEqual([
      ['i1', 'М'],
    ]);
  });

  it('пагинация после merge: total полный, страница усечена', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      inboundRow({ id: `i${i}`, createdAt: ago(5 - i) })
    );
    const { prisma } = makePrisma({
      inboundMessage: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
    });
    const res = await listIntake(prisma, manager(), { page: 2, pageSize: 2 });
    expect(res.ok && res.result.total).toBe(5);
    expect(res.ok && res.result.items.map((i) => i.id)).toEqual(['i2', 'i3']);
  });
});

describe('пороги компании (PR-3, §4.4)', () => {
  it('slaLevel считается по Company.slaWarningHours/slaResponseHours', async () => {
    const { prisma, base } = makePrisma({
      company: {
        findUnique: vi.fn().mockResolvedValue({ slaResponseHours: 6, slaWarningHours: 1 }),
      },
      inboundMessage: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            inboundRow({ id: 'r1', createdAt: ago(2) }),
            inboundRow({ id: 'r2', createdAt: ago(7) }),
          ]),
        count: vi.fn(),
      },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(base.company.findUnique as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-A' } })
    );
    expect(res.result.items.find((i) => i.id === 'r1')!.slaLevel).toBe('warning');
    expect(res.result.items.find((i) => i.id === 'r2')!.slaLevel).toBe('breach');
  });

  it('компания не найдена → фолбэк-константы 4/24', async () => {
    const { prisma } = makePrisma({
      inboundMessage: {
        findMany: vi.fn().mockResolvedValue([inboundRow({ id: 'r1', createdAt: ago(5) })]),
        count: vi.fn(),
      },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items[0]!.slaLevel).toBe('warning');
  });
});

describe('countIntake / getStaffBadges', () => {
  it('`У-318`: счётчик — сообщения + звонки; обращения и заявки не считаются; клиенту 0', async () => {
    const { prisma, base } = makePrisma({
      clientRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(2) },
      enrollmentRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(3) },
      inboundMessage: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(4) },
      call: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(1) },
    });
    expect(await countIntake(prisma, manager())).toBe(5);
    expect(base.clientRequest.count).not.toHaveBeenCalled();
    expect(base.enrollmentRequest.count).not.toHaveBeenCalled();
    expect(await countIntake(prisma, partner())).toBe(0);
  });

  it('getStaffBadges собирает все пять счётчиков меню (ФТ-8.4 + ФТ-15.2 + диалоги)', async () => {
    const { prisma, base } = makePrisma({
      clientRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(5) },
      inboundMessage: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(1) },
      task: { count: vi.fn().mockResolvedValue(7) },
    });
    expect(await getStaffBadges(prisma, manager())).toEqual({
      intake: 1,
      tasksOverdue: 7,
      clientRequestsNew: 5,
      messagesUnread: 3,
      dialogsWaiting: 4,
    });
    expect(countWaitingDialogs).toHaveBeenCalledWith(prisma, manager());
    const where = (base.task.count as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('dueDate');
    // «новые обращения» — только статус submitted, поверх скоупа роли.
    const reqWhere = (base.clientRequest.count as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(JSON.stringify(reqWhere)).toContain('submitted');
  });

  it('`У-215`: в бейдж диалогов попадает число ЖДУЩИХ дел, а не непрочитанных сообщений', async () => {
    countWaitingDialogs.mockResolvedValueOnce(0);
    const { prisma } = makePrisma();
    const quiet = await getStaffBadges(prisma, manager());
    expect(quiet.dialogsWaiting).toBe(0);
    expect(quiet.messagesUnread).toBe(3);
  });

  it('getStaffBadges: непрочитанные вне скоупа дают 0, а не падение', async () => {
    unreadCount.mockResolvedValueOnce({ ok: true, count: 0 });
    const { prisma } = makePrisma();
    const badges = await getStaffBadges(prisma, partner());
    expect(badges.messagesUnread).toBe(0);
    expect(badges.intake).toBe(0);
  });
});
