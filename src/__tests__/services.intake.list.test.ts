/**
 * Этап 7 (ФТ-8.1/8.3/8.4) — union-ридер Intake: критерии источников,
 * нормализация, сортировка по ожиданию, slaLevel, фильтры лидера, пагинация,
 * forbidden для клиентов; countIntake и getStaffBadges.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

// ФТ-15.2: счётчик непрочитанной переписки берётся готовым сервисом чата.
const { unreadCount } = vi.hoisted(() => ({ unreadCount: vi.fn() }));
vi.mock('@/lib/services/chat/threads', () => ({ unreadCount }));

import {
  listIntake,
  countIntake,
  slaLevelFor,
  intakeCallWhere,
  intakeClientRequestWhere,
  intakeInboundWhere,
  intakeEnrollmentWhere,
} from '@/lib/services/intake/list';
import { getStaffBadges } from '@/lib/services/intake/badges';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' }) as unknown as SessionPayload;

beforeEach(() => {
  unreadCount.mockResolvedValue({ ok: true, count: 3 });
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

beforeEach(() => recordPiiAccess.mockReset().mockResolvedValue(undefined));

describe('slaLevelFor и where-критерии', () => {
  it('пороги: ≤4ч ok, >4ч warning, >24ч breach', () => {
    expect(slaLevelFor(1 * H)).toBe('ok');
    expect(slaLevelFor(4 * H)).toBe('ok');
    expect(slaLevelFor(5 * H)).toBe('warning');
    expect(slaLevelFor(25 * H)).toBe('breach');
  });

  it('критерии: заявки submitted|in_triage, обучение pending, обращения unresolved, звонок без привязки/лида/закрытия', () => {
    const s = manager();
    expect(intakeClientRequestWhere(s)).toMatchObject({
      AND: [expect.anything(), { status: { in: ['submitted', 'in_triage'] } }],
    });
    expect(intakeEnrollmentWhere()).toEqual({ status: 'pending' });
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

  it('нормализует 4 источника, сортирует «дольше ждёт — выше», резолвит имена, ставит slaLevel', async () => {
    const { prisma } = makePrisma({
      clientRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'r1',
            createdAt: ago(30),
            companyName: 'ООО Ромашка',
            subject: 'Обучение',
            status: 'in_triage',
            triagedByUserId: 'm2',
            organizationId: 'org-1',
          },
        ]),
        count: vi.fn(),
      },
      enrollmentRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            createdAt: ago(5),
            claimedByUserId: null,
            organizationId: null,
            legacyCourseTitle: null,
            organization: { name: 'ООО Лютик' },
            partner: null,
            // `У-36`: направление живёт в позициях, шапочного поля больше нет.
            items: [
              { id: 'x', direction: { name: 'Высота' } },
              { id: 'y', direction: { name: 'Высота' } },
            ],
          },
        ]),
        count: vi.fn(),
      },
      inboundMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i1',
            createdAt: ago(1),
            channel: 'email',
            senderDisplay: 'Пётр',
            senderRef: 'p@x.ru',
            subject: 'Вопрос',
            body: 'Текст обращения',
            claimedByUserId: null,
            resolvedOrgId: null,
          },
        ]),
        count: vi.fn(),
      },
      call: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'c1',
            createdAt: ago(2),
            callerNumber: '+79990000000',
            durationSec: 30,
            status: 'answered',
            claimedByUserId: null,
          },
        ]),
        count: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'Мария' }]) },
    });

    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const items = res.result.items;
    // Старейшее (30ч) — первым.
    expect(items.map((i) => i.id)).toEqual(['r1', 'e1', 'c1', 'i1']);
    expect(items[0]).toMatchObject({
      type: 'client_request',
      slaLevel: 'breach',
      responsibleName: 'Мария',
      from: 'ООО Ромашка',
    });
    expect(items[1]).toMatchObject({
      type: 'enrollment',
      slaLevel: 'warning',
      essence: 'Высота · слушателей: 2',
      from: 'ООО Лютик',
    });
    expect(items[2]).toMatchObject({
      type: 'call',
      slaLevel: 'ok',
      taskTitle: 'Перезвонить: +79990000000',
    });
    expect(items[2]!.leadPrefill).toMatchObject({ contactPhone: '+79990000000' });
    expect(items[3]).toMatchObject({ type: 'inbound', from: 'Пётр' });
    expect(items[3]!.leadPrefill).toMatchObject({ contactEmail: 'p@x.ru' });
    expect(res.result.total).toBe(4);
    // ПДн-журнал: только inbound/call строки.
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ context: 'intake_list', subjectIds: ['c1', 'i1'] })
    );
  });

  it('неполные данные каждого источника подписываются читаемо', async () => {
    // Реальный интейк полон дыр: обучение без справочника и организации,
    // обращение без темы и имени, telegram-канал, ответственный, чьё имя не
    // нашлось. Каждая строка обязана остаться читаемой — по подписи сотрудник
    // решает, что брать в работу.
    const { prisma } = makePrisma({
      enrollmentRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e-legacy',
            createdAt: ago(2),
            claimedByUserId: 'ghost',
            organizationId: null,
            legacyCourseTitle: 'Старый курс',
            organization: null,
            partner: { name: 'ООО Партнёр' },
            direction: null,
            items: [],
          },
          {
            id: 'e-bare',
            createdAt: ago(1),
            claimedByUserId: null,
            organizationId: null,
            legacyCourseTitle: null,
            organization: null,
            partner: null,
            direction: null,
            items: [],
          },
        ]),
        count: vi.fn(),
      },
      inboundMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i-tg',
            createdAt: ago(3),
            channel: 'telegram',
            senderDisplay: '  ',
            senderRef: 'tg:123',
            subject: null,
            body: 'Длинный текст обращения без темы',
            claimedByUserId: null,
            resolvedOrgId: null,
          },
          {
            id: 'i-sms',
            createdAt: ago(4),
            channel: 'sms',
            senderDisplay: 'Аноним',
            senderRef: 'sms:1',
            subject: '  ',
            body: 'Текст',
            claimedByUserId: null,
            resolvedOrgId: null,
          },
        ]),
        count: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) }, // имя ghost не нашлось
    });

    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const by = Object.fromEntries(res.result.items.map((i) => [i.id, i]));

    // Обучение: legacy-название; партнёр как отправитель; прочерк, когда нет никого.
    expect(by['e-legacy']).toMatchObject({
      essence: 'Старый курс · слушателей: 0',
      from: 'ООО Партнёр',
    });
    expect(by['e-bare']).toMatchObject({
      essence: 'Заявка на обучение · слушателей: 0',
      from: '—',
    });
    // Имя ответственного не нашлось → null, не падение.
    expect(by['e-legacy']!.responsibleName).toBeNull();

    // Обращение: пустое имя → senderRef; без темы → срез тела; канал по словарю.
    expect(by['i-tg']).toMatchObject({ from: 'tg:123' });
    expect(by['i-tg']!.essence).toBe('Telegram: Длинный текст обращения без темы');
    expect(by['i-tg']!.leadPrefill).toMatchObject({
      contactEmail: '',
      subject: 'Обращение из внешнего канала',
    });
    // Незнакомый канал показывается как есть.
    expect(by['i-sms']!.essence).toContain('sms:');
  });

  it('звонок без длительности (пропущенный) подписывается статусом', async () => {
    // У пропущенного звонка нет длительности — по статусу сотрудник видит, что
    // человеку не ответили и надо перезвонить в первую очередь.
    const { prisma } = makePrisma({
      call: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'c-missed',
            createdAt: ago(1),
            callerNumber: '+79991112233',
            durationSec: null,
            status: 'missed',
            claimedByUserId: null,
          },
        ]),
        count: vi.fn(),
      },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.items[0]!.essence).toBe('Входящий звонок · missed');
  });

  it('сотрудник без компании: звонки — только общая корзина (companyId=null)', async () => {
    const calls = vi.fn().mockResolvedValue([]);
    const { prisma } = makePrisma({ call: { findMany: calls, count: vi.fn() } });
    const res = await listIntake(prisma, { ...manager(), companyId: undefined } as never);
    expect(res.ok).toBe(true);
    const where = calls.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('__no_company__');
  });

  it('фильтры лидера: onlyUnassigned и assigneeId', async () => {
    const rows = [
      {
        id: 'r1',
        createdAt: ago(3),
        companyName: 'A',
        subject: 's',
        status: 'in_triage',
        triagedByUserId: 'm2',
        organizationId: null,
      },
      {
        id: 'r2',
        createdAt: ago(2),
        companyName: 'B',
        subject: 's',
        status: 'submitted',
        triagedByUserId: null,
        organizationId: null,
      },
    ];
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', name: 'М' }]) },
    });

    const unassigned = await listIntake(prisma, manager(), { onlyUnassigned: true });
    expect(unassigned.ok && unassigned.result.items.map((i) => i.id)).toEqual(['r2']);

    const byAssignee = await listIntake(prisma, manager(), { assigneeId: 'm2' });
    expect(byAssignee.ok && byAssignee.result.items.map((i) => i.id)).toEqual(['r1']);
  });

  it('пагинация после merge: total полный, страница усечена', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      createdAt: ago(5 - i),
      companyName: 'A',
      subject: 's',
      status: 'submitted' as const,
      triagedByUserId: null,
      organizationId: null,
    }));
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
    });
    const res = await listIntake(prisma, manager(), { page: 2, pageSize: 2 });
    expect(res.ok && res.result.total).toBe(5);
    expect(res.ok && res.result.items).toHaveLength(2);
    expect(res.ok && res.result.items.map((i) => i.id)).toEqual(['r2', 'r3']);
  });

  it('submitted-заявка без triage не имеет ответственного (triagedByUserId прошлого триажа игнорируется)', async () => {
    const rows = [
      {
        id: 'r1',
        createdAt: ago(1),
        companyName: 'A',
        subject: 's',
        status: 'submitted',
        triagedByUserId: 'm9',
        organizationId: null,
      },
    ];
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items[0]!.responsibleUserId).toBeNull();
  });
});

describe('пороги компании (PR-3, §4.4)', () => {
  it('slaLevel считается по Company.slaWarningHours/slaResponseHours', async () => {
    const rows = [
      {
        id: 'r1',
        createdAt: ago(2),
        companyName: 'A',
        subject: 's',
        status: 'submitted',
        triagedByUserId: null,
        organizationId: null,
      },
      {
        id: 'r2',
        createdAt: ago(7),
        companyName: 'B',
        subject: 's',
        status: 'submitted',
        triagedByUserId: null,
        organizationId: null,
      },
    ];
    const { prisma, base } = makePrisma({
      company: {
        findUnique: vi.fn().mockResolvedValue({ slaResponseHours: 6, slaWarningHours: 1 }),
      },
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(base.company.findUnique as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-A' } })
    );
    // 2ч при порогах 1/6 → warning; 7ч → breach.
    expect(res.result.items.find((i) => i.id === 'r1')!.slaLevel).toBe('warning');
    expect(res.result.items.find((i) => i.id === 'r2')!.slaLevel).toBe('breach');
  });

  it('компания не найдена → фолбэк-константы 4/24', async () => {
    const rows = [
      {
        id: 'r1',
        createdAt: ago(5),
        companyName: 'A',
        subject: 's',
        status: 'submitted',
        triagedByUserId: null,
        organizationId: null,
      },
    ];
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn() },
    });
    const res = await listIntake(prisma, manager());
    expect(res.ok && res.result.items[0]!.slaLevel).toBe('warning');
  });
});

describe('countIntake / getStaffBadges', () => {
  it('счётчик — сумма 4 count-запросов; клиенту 0', async () => {
    const { prisma } = makePrisma({
      clientRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(2) },
      enrollmentRequest: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(3) },
      inboundMessage: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(4) },
      call: { findMany: vi.fn(), count: vi.fn().mockResolvedValue(1) },
    });
    expect(await countIntake(prisma, manager())).toBe(10);
    expect(await countIntake(prisma, partner())).toBe(0);
  });

  it('getStaffBadges собирает все четыре счётчика меню (ФТ-8.4 + ФТ-15.2)', async () => {
    const { prisma, base } = makePrisma({
      // count вызывается дважды: Intake-часть и «новые обращения» (ФТ-15.2).
      clientRequest: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(5),
      },
      task: { count: vi.fn().mockResolvedValue(7) },
    });
    expect(await getStaffBadges(prisma, manager())).toEqual({
      intake: 1,
      tasksOverdue: 7,
      clientRequestsNew: 5,
      messagesUnread: 3,
    });
    const where = (base.task.count as ReturnType<typeof vi.fn>).mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('dueDate');

    // «новые обращения» — только статус submitted, поверх скоупа роли.
    const reqWhere = (base.clientRequest.count as ReturnType<typeof vi.fn>).mock.calls[1]![0].where;
    expect(JSON.stringify(reqWhere)).toContain('submitted');
  });

  it('getStaffBadges: непрочитанные вне скоупа дают 0, а не падение', async () => {
    unreadCount.mockResolvedValueOnce({ ok: true, count: 0 });
    const { prisma } = makePrisma({
      clientRequest: {
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      },
      task: { count: vi.fn().mockResolvedValue(0) },
    });
    const badges = await getStaffBadges(prisma, partner());
    expect(badges.messagesUnread).toBe(0);
    expect(badges.intake).toBe(0);
  });
});
