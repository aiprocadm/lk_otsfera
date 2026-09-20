import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { setDocumentStatus, logWarn, logError, logInfo, liveFindMany, emitAutomationEvent } =
  vi.hoisted(() => ({
    setDocumentStatus: vi.fn(),
    // Тип объявлен явно: без параметров `mock.calls` получает пустой кортеж,
    // и обращение к `calls[0][1]` не проходит проверку типов.
    emitAutomationEvent: vi.fn<(prisma: unknown, args: unknown) => Promise<number>>(async () => 0),
    logWarn: vi.fn(),
    logError: vi.fn(),
    logInfo: vi.fn(),
    liveFindMany: vi.fn(async () => [] as Array<{ id: string }>),
  }));
// Обёртка задачи берёт базу сама (`await import`), поэтому модуль подменяем:
// иначе тест поднял бы настоящего клиента Prisma и полез в базу.
vi.mock('@/lib/db/prisma', () => ({ prisma: { document: { findMany: liveFindMany } } }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));
// `У-222`: истечение предложения — событие для правил автоматизации. Без мока
// диспетчер полез бы в отсутствующие таблицы мок-базы и молча вернул ноль, и
// проверить содержимое события было бы нечем.
vi.mock('@/lib/automation/dispatch', () => ({ emitAutomationEvent }));
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, error: logError, info: logInfo },
}));

import { runExpireProposals, expireProposalsProcessor } from '@/worker/processors/expire-proposals';
import { expiredProposalsWhere } from '@/lib/documents/proposalExpiry';

/**
 * `У-164` (этап 7) — ночная задача «истёк срок предложения».
 *
 * Проверяем не «перевела статус», а то, ради чего задачу вообще писали руками,
 * а не одним `updateMany`: каждая бумага проходит через единственную дверь к
 * статусу, у каждой остаётся строка в журнале, и одна сломанная строка не
 * убивает весь ночной заход.
 */
const NOW = new Date('2026-09-16T22:00:00.000Z');

type DocRow = {
  id: string;
  sentById: string | null;
  counterpartyType?: string;
  counterpartyId?: string | null;
  number?: string;
  companyId?: string;
  orderId?: string | null;
  leadId?: string | null;
};

function makePrisma(docs: DocRow[]) {
  // Аргумент объявлен явно: без него `mock.calls` получает пустой кортеж, и
  // обращение к `calls[0][0]` не собирается.
  const findMany = vi.fn(async (args: { where?: unknown; take?: number; orderBy?: unknown }) => {
    void args;
    return docs;
  });
  const prisma = { document: { findMany } } as unknown as PrismaClient;
  return { prisma, findMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  setDocumentStatus.mockResolvedValue({ ok: true });
  emitAutomationEvent.mockResolvedValue(0);
});

describe('runExpireProposals — выборка', () => {
  it('берёт ровно то, что считает истёкшим общий расчёт', () => {
    // Собственного условия у задачи нет и быть не должно: разойдись оно с
    // расчётом на экране — карточка и база сказали бы разное.
    const { prisma, findMany } = makePrisma([]);
    return runExpireProposals(prisma, NOW).then(() => {
      expect(findMany.mock.calls[0]![0].where).toEqual(expiredProposalsWhere(NOW));
    });
  });

  it('порция ограничена и берётся с самых давних — остаток добьётся завтра', async () => {
    const { prisma, findMany } = makePrisma([]);
    await runExpireProposals(prisma, NOW);
    expect(findMany.mock.calls[0]![0].take).toBe(500);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ validUntil: 'asc' });
  });

  it('истекать нечего — тихий заход без единого обращения к двери статусов', async () => {
    const { prisma } = makePrisma([]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 0,
      skippedNoActor: 0,
      failed: 0,
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });
});

describe('runExpireProposals — перевод статуса', () => {
  it('каждая бумага идёт через дверь статусов ПО ОТДЕЛЬНОСТИ', async () => {
    // Одним `updateMany` в журнале не осталось бы ни строки, и «когда истёк
    // этот документ» выяснить было бы нечем.
    const { prisma } = makePrisma([
      { id: 'd1', sentById: 'u1' },
      { id: 'd2', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toMatchObject({ expired: 2, failed: 0 });
    expect(setDocumentStatus).toHaveBeenCalledTimes(2);
    expect(setDocumentStatus.mock.calls[0]![2]).toEqual({ documentId: 'd1', to: 'expired' });
  });

  it('действие приписывается ОТПРАВИТЕЛЮ — по его воле пошёл срок', async () => {
    // Системного пользователя в проекте нет, а `AuditLog.userId` обязателен.
    // Ближайший честный ответ на «по чьей воле это произошло» — тот, кто
    // отправил предложение клиенту.
    const { prisma } = makePrisma([{ id: 'd1', sentById: 'u-sender' }]);
    await runExpireProposals(prisma, NOW);
    expect(setDocumentStatus.mock.calls[0]![1]).toMatchObject({ sub: 'u-sender' });
  });

  it('без отправителя бумага пропускается, а не подписывается кем попало', async () => {
    // Выдумать автора в журнале хуже, чем оставить документ как есть: такое
    // бывает у бумаг, приехавших извне, и переведёт их человек руками.
    const { prisma } = makePrisma([{ id: 'd1', sentById: null }]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 0,
      skippedNoActor: 1,
      failed: 0,
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });
});

describe('runExpireProposals — одна плохая строка не рушит заход', () => {
  it('отказ двери статусов считается и записывается, остальные продолжают', async () => {
    // Отказ означает, что выборка и матрица переходов разошлись, — молчать
    // нельзя, но и ронять ночной заход из-за одной бумаги тоже.
    setDocumentStatus
      .mockResolvedValueOnce({ ok: false, error: 'invalid_transition' })
      .mockResolvedValueOnce({ ok: true });
    const { prisma } = makePrisma([
      { id: 'bad', sentById: 'u1' },
      { id: 'good', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 1,
      skippedNoActor: 0,
      failed: 1,
    });
    expect(logWarn).toHaveBeenCalled();
  });

  it('событие правилам несёт организацию ТОЛЬКО когда адресат — организация', async () => {
    // Предложение выставляют и лиду, и организации. Подставить `counterpartyId`
    // лида в поле `organizationId` — значит отправить правило искать
    // организацию с идентификатором лида: правило либо не сработает, либо
    // сработает не на том клиенте.
    const { prisma } = makePrisma([
      {
        id: 'd-org',
        sentById: 'u1',
        number: 'КП-1',
        companyId: 'co-1',
        counterpartyType: 'organization',
        counterpartyId: 'org-7',
        orderId: 'ord-1',
        leadId: null,
      },
      {
        id: 'd-lead',
        sentById: 'u1',
        number: 'КП-2',
        companyId: 'co-1',
        counterpartyType: 'lead',
        counterpartyId: 'lead-9',
        orderId: null,
        leadId: 'lead-9',
      },
    ]);

    await runExpireProposals(prisma, NOW);

    expect(emitAutomationEvent).toHaveBeenCalledTimes(2);
    expect(emitAutomationEvent.mock.calls[0]![1]).toMatchObject({
      trigger: 'proposal_no_answer',
      payload: expect.objectContaining({ documentId: 'd-org', organizationId: 'org-7' }),
    });
    expect(emitAutomationEvent.mock.calls[1]![1]).toMatchObject({
      payload: expect.objectContaining({ documentId: 'd-lead', organizationId: null }),
    });
  });

  it('исключение не-Error на бумаге тоже читается строкой', async () => {
    // Иначе в журнале ночного захода вместо причины окажется «[object Object]»,
    // и утром никто не поймёт, почему документ не истёк.
    setDocumentStatus.mockRejectedValueOnce('пользователь удалён');
    const { prisma } = makePrisma([{ id: 'd1', sentById: 'u1' }]);
    expect(await runExpireProposals(prisma, NOW)).toMatchObject({ expired: 0, failed: 1 });
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'пользователь удалён' })
    );
  });

  it('исключение на одной бумаге тоже не останавливает остальные', async () => {
    // Самый вероятный случай — удалённый отправитель: журнал ссылается на
    // настоящего пользователя, а отметка в документе — просто строка.
    setDocumentStatus
      .mockRejectedValueOnce(new Error('нет такого пользователя'))
      .mockResolvedValueOnce({ ok: true });
    const { prisma } = makePrisma([
      { id: 'gone', sentById: 'u-deleted' },
      { id: 'good', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 1,
      skippedNoActor: 0,
      failed: 1,
    });
    expect(logError).toHaveBeenCalled();
  });

  it('итог захода попадает в журнал: ночную задачу читают по логам', async () => {
    const { prisma } = makePrisma([{ id: 'd1', sentById: 'u1' }]);
    await runExpireProposals(prisma, NOW);
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('expire-proposals'),
      expect.objectContaining({ expired: 1, found: 1 })
    );
  });
});

/**
 * Обёртка задачи: что именно она берёт и чем зовёт работу.
 *
 * Обёртка крошечная, но у неё есть своё обещание — **«сейчас» берётся в момент
 * запуска, а не в момент сборки модуля**. Возьми она время загрузки воркера, и
 * долгоживущий процесс каждую ночь истекал бы бумаги по вчерашней дате.
 */
describe('expireProposalsProcessor — обёртка задачи', () => {
  it('идёт в живую базу и считает срок от текущего момента', async () => {
    liveFindMany.mockClear();
    const before = Date.now();

    const res = await expireProposalsProcessor();

    expect(res).toEqual({ expired: 0, skippedNoActor: 0, failed: 0 });
    expect(liveFindMany).toHaveBeenCalledTimes(1);

    // Условие выборки строит общее правило `expiredProposalsWhere`; сверяем
    // его с тем, что оно даёт для «сейчас», — так тест не повторяет чужую
    // логику границы суток, а проверяет, что момент взят свежий.
    const passed = JSON.stringify(
      (liveFindMany.mock.calls[0] as unknown as [{ where: unknown }])[0].where
    );
    expect(passed).toBe(JSON.stringify(expiredProposalsWhere(new Date(before))));
  });
});
