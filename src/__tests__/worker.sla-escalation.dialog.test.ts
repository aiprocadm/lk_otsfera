/**
 * `У-207` — диалог как источник SLA-эскалации: ждёт ответа сотрудника дольше
 * порога компании → руководитель узнаёт об этом, и ссылка ведёт в саму
 * переписку. Ключ дедупа составной, поэтому второе молчание того же диалога
 * не проглатывается журналом.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordNotification, deliverNotificationToUser, logError } = vi.hoisted(() => ({
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, info: vi.fn(), warn: vi.fn() } }));

import { runSlaEscalation } from '@/worker/processors/sla-escalation';

const NOW = new Date('2026-09-14T12:00:00Z');
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * H);

const COMPANY_A = { id: 'co-A', slaResponseHours: 6, users: [{ id: 'lead-A' }] };

function makePrisma(
  dialogs: unknown[],
  companies: unknown[] = [COMPANY_A],
  /** Соседние источники очереди — нужны тесту «формулировка не поехала». */
  others: { inbound?: unknown[] } = {}
) {
  const create = vi.fn().mockResolvedValue({});
  const dialogFindMany = vi.fn().mockResolvedValue(dialogs);
  const prisma = {
    company: { findMany: vi.fn().mockResolvedValue(companies) },
    clientRequest: { findMany: vi.fn().mockResolvedValue([]) },
    enrollmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue(others.inbound ?? []) },
    messengerDialog: { findMany: dialogFindMany },
    call: { findMany: vi.fn().mockResolvedValue([]) },
    slaEscalation: { create },
  } as unknown as PrismaClient;
  return { prisma, create, dialogFindMany };
}

/** Диалог в ожидании ответа: молчим уже 9 часов при пороге компании 6. */
function overdueDialog(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    waitingSince: ago(9),
    companyId: 'co-A',
    channel: 'telegram',
    peerDisplay: 'Иван Петров',
    peerRef: 'chat-1',
    contact: null,
    ...over,
  };
}

beforeEach(() => {
  recordNotification.mockReset().mockResolvedValue({ row: { id: 'n1' }, deduped: false });
  deliverNotificationToUser.mockReset().mockResolvedValue({});
  logError.mockReset();
});

describe('SLA-эскалация диалога', () => {
  it('диалог ждёт ответа дольше порога компании → эскалация руководителю', async () => {
    const { prisma, create } = makePrisma([overdueDialog()]);
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 1 });
    expect(create).toHaveBeenCalledWith({
      data: {
        sourceType: 'dialog',
        sourceId: `d1:${ago(9).toISOString()}`,
        companyId: 'co-A',
      },
    });
    const call = recordNotification.mock.calls[0]![1];
    expect(call).toMatchObject({ userId: 'lead-A', type: 'sla_escalation' });
    expect(call.body).toContain('диалог в Telegram с Иван Петров');
    expect(call.body).toContain('порог 6 ч');
  });

  it('в строке нет адреса кабинета: ссылку в диалог строит таблица по источнику и его id (У-232)', async () => {
    const { prisma } = makePrisma([overdueDialog()]);
    await runSlaEscalation(prisma, NOW);
    const meta = { sourceType: 'dialog', sourceId: `d1:${ago(9).toISOString()}` };
    // Ключ дедупа — та же единица Intake, что и в журнале `SlaEscalation`.
    expect(recordNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ meta, entityId: meta.sourceId })
    );
    expect(recordNotification.mock.calls[0]![1].meta).not.toHaveProperty('url');
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sla_escalation', meta, dedupKey: 'n1' })
    );
    expect(deliverNotificationToUser.mock.calls[0]![0]).not.toHaveProperty('url');
  });

  it('повтор за час (deduped: true) — доставка не зовётся, эскалация засчитана', async () => {
    recordNotification.mockResolvedValue({ row: { id: 'n1' }, deduped: true });
    const { prisma } = makePrisma([overdueDialog()]);
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 1 });
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });

  it('ключ дедупа составной: второе молчание того же диалога даёт НОВУЮ строку журнала', async () => {
    // Иначе диалог, однажды просроченный, больше никогда бы не позвал
    // руководителя: уникальность журнала стоит на паре «источник + id».
    const first = makePrisma([overdueDialog({ waitingSince: ago(30) })]);
    await runSlaEscalation(first.prisma, NOW);
    const second = makePrisma([overdueDialog({ waitingSince: ago(9) })]);
    await runSlaEscalation(second.prisma, NOW);

    const key = (c: ReturnType<typeof vi.fn>) => c.mock.calls[0]![0].data.sourceId as string;
    expect(key(first.create)).toBe(`d1:${ago(30).toISOString()}`);
    expect(key(second.create)).toBe(`d1:${ago(9).toISOString()}`);
    expect(key(first.create)).not.toBe(key(second.create));
    // При этом сам диалог в ключе остался — по нему видно, о ком речь.
    expect(key(second.create).startsWith('d1:')).toBe(true);
  });

  it('в выборку берутся только диалоги в ожидании ответа — «ждём клиента» не эскалируется', async () => {
    const { prisma, dialogFindMany, create } = makePrisma([]);
    await runSlaEscalation(prisma, NOW);
    // Отсечка сделана запросом, поэтому доказываем её условием `where`:
    // диалог в `waiting_client` (ответ уже дан) в выборку не попадёт вовсе.
    expect(dialogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'waiting_staff', waitingSince: { not: null } },
      })
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('молчание короче порога компании не эскалируется', async () => {
    const { prisma, create } = makePrisma([overdueDialog({ waitingSince: ago(5) })]);
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('ничей диалог (без компании) идёт по дефолт-порогу и ко всем руководителям', async () => {
    const { prisma } = makePrisma(
      [overdueDialog({ id: 'd2', companyId: null, waitingSince: ago(25) })],
      [COMPANY_A, { id: 'co-B', slaResponseHours: 100, users: [{ id: 'lead-B' }] }]
    );
    expect(await runSlaEscalation(prisma, NOW)).toEqual({ escalated: 1 });
    expect(recordNotification).toHaveBeenCalledTimes(2);
    expect(recordNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'lead-B' })
    );
  });

  it('текст про диалог говорит «нет ответа клиенту», а не «без ответственного»', async () => {
    // У диалога ответственный намеренно не учитывается: назначенный и
    // неотвеченный — это как раз то, что руководитель должен увидеть. Но
    // тогда и формулировка должна быть про отсутствие ОТВЕТА, иначе
    // руководитель пойдёт искать «свободный» диалог, которого нет.
    const { prisma } = makePrisma([overdueDialog()]);
    await runSlaEscalation(prisma, NOW);
    const call = recordNotification.mock.calls[0]![1];
    expect(call.body as string).toContain('Нет ответа клиенту');
    expect(call.body as string).not.toContain('Без ответственного');
    expect(call.title as string).toBe('SLA: клиент ждёт ответа');
  });

  it('у прочих источников формулировка прежняя — «без ответственного»', async () => {
    // Диалог получил свой текст, но соседние источники его не потеряли.
    const { prisma } = makePrisma([], undefined, {
      inbound: [
        {
          id: 'im1',
          createdAt: ago(25),
          companyId: 'co-A',
          senderDisplay: 'Клиент',
          senderRef: 'c@t.test',
          subject: 'счёт',
        },
      ],
    });
    await runSlaEscalation(prisma, NOW);
    const call = recordNotification.mock.calls[0]![1];
    expect(call.body as string).toContain('Без ответственного');
    expect(call.title as string).toBe('SLA: входящее без реакции');
  });

  it('подпись собирается и на неполных данных: имя контакта важнее прозвища, иначе адрес', async () => {
    const { prisma } = makePrisma([
      overdueDialog({ id: 'd3', contact: { name: 'ООО «Ромашка», Пётр' } }),
      overdueDialog({ id: 'd4', peerDisplay: '   ', contact: null }),
      overdueDialog({ id: 'd5', channel: 'unknown_channel', peerDisplay: 'Аноним' }),
    ]);
    await runSlaEscalation(prisma, NOW);
    const bodies = recordNotification.mock.calls.map((c) => c[1].body as string).join(' ');
    expect(bodies).toContain('ООО «Ромашка», Пётр');
    expect(bodies).toContain('с chat-1'); // пустое прозвище → адрес собеседника
    expect(bodies).toContain('unknown_channel'); // незнакомый канал показываем как есть
  });
});
