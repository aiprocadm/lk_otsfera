/**
 * Этап 7 (ФТ-8.5, PR-3) — процессор SLA-эскалации: порог из компании единицы,
 * дефолт для общей очереди, дедуп журналом (P2002-skip), получатели —
 * руководители компании / всех компаний, graceful при сбое доставки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';

const { createNotification, deliverNotificationToUser, logError } = vi.hoisted(() => ({
  createNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    company: { findMany: vi.fn().mockResolvedValue([]) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([]) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]) },
    call: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { runSlaEscalation, slaEscalationProcessor } from '@/worker/processors/sla-escalation';

const NOW = new Date('2026-07-26T12:00:00Z');
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

const P2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '5.0.0',
});

type Over = Partial<
  Record<'companies' | 'requests' | 'enrollments' | 'inbound' | 'calls', unknown[]>
>;

function makePrisma(over: Over = {}, journalCreate?: ReturnType<typeof vi.fn>) {
  const create = journalCreate ?? vi.fn().mockResolvedValue({});
  const prisma = {
    company: { findMany: vi.fn().mockResolvedValue(over.companies ?? []) },
    clientRequest: { findMany: vi.fn().mockResolvedValue(over.requests ?? []) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue(over.enrollments ?? []) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue(over.inbound ?? []) },
    call: { findMany: vi.fn().mockResolvedValue(over.calls ?? []) },
    slaEscalation: { create },
  } as unknown as PrismaClient;
  return { prisma, create };
}

const COMPANY_A = { id: 'co-A', slaResponseHours: 6, users: [{ id: 'lead-A' }] };
const COMPANY_B = { id: 'co-B', slaResponseHours: 100, users: [{ id: 'lead-B' }] };

beforeEach(() => {
  createNotification.mockReset().mockResolvedValue({ id: 'n1' });
  deliverNotificationToUser.mockReset().mockResolvedValue({});
  logError.mockReset();
});

describe('runSlaEscalation', () => {
  it('эскалирует просроченную заявку руководителям её компании (порог компании)', async () => {
    const { prisma, create } = makePrisma({
      companies: [COMPANY_A, COMPANY_B],
      requests: [
        {
          id: 'r1',
          createdAt: ago(7),
          companyName: 'ООО',
          subject: 'Тема',
          organization: { companyId: 'co-A' },
        },
      ],
    });
    const res = await runSlaEscalation(prisma, NOW);
    expect(res).toEqual({ escalated: 1 });
    expect(create).toHaveBeenCalledWith({
      data: { sourceType: 'client_request', sourceId: 'r1', companyId: 'co-A' },
    });
    // Только руководитель компании A (7ч > 6ч порога A; порог B не при чём).
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'lead-A',
        type: 'sla_escalation',
        meta: expect.objectContaining({ url: '/leader/intake' }),
      })
    );
    const body = createNotification.mock.calls[0]![0].body as string;
    expect(body).toContain('порог 6 ч');
    expect(body).toContain('заявка клиента');
  });

  it('младше порога — не эскалирует; порог чужой компании 100ч удерживает', async () => {
    const { prisma, create } = makePrisma({
      companies: [COMPANY_A, COMPANY_B],
      requests: [
        {
          id: 'r-young',
          createdAt: ago(5),
          companyName: 'X',
          subject: 's',
          organization: { companyId: 'co-A' },
        },
        {
          id: 'r-b',
          createdAt: ago(50),
          companyName: 'Y',
          subject: 's',
          organization: { companyId: 'co-B' },
        },
      ],
    });
    const res = await runSlaEscalation(prisma, NOW);
    expect(res).toEqual({ escalated: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('общая очередь (companyId=null): дефолт-порог 24ч, получатели — руководители всех компаний', async () => {
    const { prisma } = makePrisma({
      companies: [COMPANY_A, COMPANY_B],
      inbound: [
        {
          id: 'i1',
          createdAt: ago(25),
          companyId: null,
          senderDisplay: 'Пётр',
          senderRef: 'p@x.ru',
          subject: 'Вопрос',
        },
      ],
      calls: [{ id: 'c1', createdAt: ago(30), companyId: null, callerNumber: '+7999' }],
    });
    const res = await runSlaEscalation(prisma, NOW);
    expect(res).toEqual({ escalated: 2 });
    // 2 единицы × 2 руководителя.
    expect(createNotification).toHaveBeenCalledTimes(4);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'lead-B' }));
    const bodies = createNotification.mock.calls.map((c) => c[0].body as string).join(' ');
    expect(bodies).toContain('обращение от Пётр');
    expect(bodies).toContain('входящий звонок с +7999');
  });

  it('подписи собираются и на неполных данных: без организации, без темы, без имени отправителя', async () => {
    // Просроченные единицы приходят из разных источников, и часть полей может
    // быть пустой. Подпись в уведомлении обязана остаться читаемой — по ней
    // руководитель понимает, что именно зависло.
    const { prisma } = makePrisma({
      companies: [COMPANY_A],
      requests: [
        {
          id: 'r-no-org',
          createdAt: ago(30),
          companyName: 'ООО Без-орг',
          subject: 'Тема',
          organization: null,
        },
      ],
      enrollments: [
        {
          id: 'e-legacy',
          createdAt: ago(30),
          organization: null,
          // `У-36`: направление читается из позиций; у старой заявки их нет,
          // поэтому подпись даёт текстовый курс.
          items: [],
          legacyCourseTitle: 'Старый курс',
        },
        {
          id: 'e-bare',
          createdAt: ago(30),
          organization: null,
          items: [],
          legacyCourseTitle: null,
        },
      ],
      inbound: [
        {
          id: 'i-bare',
          createdAt: ago(30),
          companyId: null,
          senderDisplay: '   ',
          senderRef: 'anon@x.ru',
          subject: null,
        },
      ],
    });

    const res = await runSlaEscalation(prisma, NOW);
    expect(res.escalated).toBe(4);

    const bodies = createNotification.mock.calls.map((c) => c[0].body as string).join(' ');
    expect(bodies).toContain('Старый курс'); // legacy-название вместо справочника
    expect(bodies).toContain('обучение'); // ни справочника, ни legacy → общее слово
    expect(bodies).toContain('обращение от anon@x.ru'); // пустое имя → адрес отправителя
    expect(bodies).not.toContain('«»'); // темы нет — пустых кавычек тоже
  });

  it('дедуп: P2002 из журнала пропускает единицу без уведомлений; иные ошибки пробрасываются', async () => {
    const dup = vi.fn().mockRejectedValue(P2002);
    const { prisma } = makePrisma(
      {
        companies: [COMPANY_A],
        enrollments: [
          {
            id: 'e1',
            createdAt: ago(10),
            organization: { name: 'О', companyId: 'co-A' },
            items: [{ direction: { name: 'Высота' } }],
            legacyCourseTitle: null,
          },
        ],
      },
      dup
    );
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 0 });
    expect(createNotification).not.toHaveBeenCalled();

    const boom = vi.fn().mockRejectedValue(new Error('db down'));
    const { prisma: p2 } = makePrisma(
      {
        companies: [COMPANY_A],
        requests: [
          {
            id: 'r1',
            createdAt: ago(10),
            companyName: 'X',
            subject: 's',
            organization: { companyId: 'co-A' },
          },
        ],
      },
      boom
    );
    await expect(runSlaEscalation(p2, NOW)).rejects.toThrow('db down');
  });

  it('без руководителей — единица пропускается (журнал не пишется)', async () => {
    const { prisma, create } = makePrisma({
      companies: [{ id: 'co-A', slaResponseHours: 6, users: [] }],
      requests: [
        {
          id: 'r1',
          createdAt: ago(10),
          companyName: 'X',
          subject: 's',
          organization: { companyId: 'co-A' },
        },
      ],
    });
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('сбой доставки одному получателю логируется, единица остаётся эскалированной', async () => {
    createNotification
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValue({ id: 'n2' });
    const twoLeaders = { id: 'co-A', slaResponseHours: 6, users: [{ id: 'l1' }, { id: 'l2' }] };
    const { prisma } = makePrisma({
      companies: [twoLeaders],
      requests: [
        {
          id: 'r1',
          createdAt: ago(10),
          companyName: 'X',
          subject: 's',
          organization: { companyId: 'co-A' },
        },
      ],
    });
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 1 });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  });
});

describe('slaEscalationProcessor (BullMQ wrapper)', () => {
  it('работает на глобальном prisma', async () => {
    expect(await slaEscalationProcessor()).toEqual({ escalated: 0 });
  });
});
