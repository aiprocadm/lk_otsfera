/**
 * Сервис «Вписать номер документу из 1С» (`У-151`, дефект `Д-5`).
 *
 * 1С отдаёт счета и договоры без номера, и от такого счёта не выпускался акт.
 * Тесты держат три вещи: номер правит только сотрудник ЦО, вписать его можно
 * ровно один раз, и занятость номера проверяется по «эффективной компании»
 * (своё поле документа ИЛИ компания его заказа). Prisma — фейк.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, canReadDocument } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  canReadDocument: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));

import { setDocumentNumber } from '@/lib/services/documents/number';

const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;
const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;
const leader = (): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId: 'co-A' }) as unknown as SessionPayload;
const orgUser = (): SessionPayload =>
  ({ sub: 'o1', role: 'organization' }) as unknown as SessionPayload;
const partner = (): SessionPayload => ({ sub: 'p1', role: 'partner' }) as unknown as SessionPayload;

/** Документ из 1С: номера нет, компания своя, версия первая. */
const doc1c = (over: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  number: null,
  type: 'invoice',
  version: 1,
  companyId: 'co-A',
  orderId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  order: null,
  ...over,
});

function makePrisma(over: { doc?: unknown; clash?: unknown } = {}) {
  const update = vi.fn().mockResolvedValue({});
  const tx = { document: { update } };
  const findUnique = vi.fn().mockResolvedValue('doc' in over ? over.doc : doc1c());
  const findFirst = vi.fn().mockResolvedValue(over.clash ?? null);
  const $transaction = vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
  const prisma = {
    document: { findUnique, findFirst },
    $transaction,
  } as unknown as PrismaClient;
  return { prisma, tx, update, findUnique, findFirst, $transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadDocument.mockResolvedValue(true);
});

describe('setDocumentNumber — кто вправе', () => {
  it('клиентские роли получают forbidden ДО обращения к базе', async () => {
    const { prisma, findUnique } = makePrisma();
    for (const session of [orgUser(), partner()]) {
      expect(
        await setDocumentNumber(prisma, session, { documentId: 'doc-1', number: 'СЧ-7' })
      ).toEqual({ ok: false, error: 'forbidden' });
    }
    // Номер — часть бумаги, а не заметка клиента: до чтения документа не доходим,
    // иначе чужой кабинет мог бы по кодам ошибок нащупать чужие документы.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('менеджер, руководитель и админ проходят гард', async () => {
    for (const session of [manager(), leader(), admin()]) {
      const { prisma } = makePrisma();
      expect(
        await setDocumentNumber(prisma, session, { documentId: 'doc-1', number: 'СЧ-7' })
      ).toEqual({ ok: true });
    }
  });
});

describe('setDocumentNumber — проверка самого номера', () => {
  it('пустой номер и номер длиннее 64 символов отклоняются до базы', async () => {
    const { prisma, findUnique } = makePrisma();
    // Пробелы — это не номер: после trim строка пустая.
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: '   ' })
    ).toEqual({
      ok: false,
      error: 'number_invalid',
    });
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'x'.repeat(65) })
    ).toEqual({ ok: false, error: 'number_invalid' });
    expect(findUnique).not.toHaveBeenCalled();
    // Ровно 64 — ещё в пределах: граница включающая, «ДС-2026-1234» и запас.
    const ok = makePrisma();
    expect(
      await setDocumentNumber(ok.prisma, admin(), { documentId: 'doc-1', number: 'x'.repeat(64) })
    ).toEqual({ ok: true });
  });

  it('лишние пробелы по краям срезаются: в базу и в журнал идёт чистый номер', async () => {
    const { prisma, update } = makePrisma();
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: '  СЧ-7  ' })
    ).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { number: 'СЧ-7' } });
    expect(recordAudit.mock.calls[0]![1]).toMatchObject({ after: { number: 'СЧ-7' } });
  });
});

describe('setDocumentNumber — какому документу можно', () => {
  it('исчезнувший документ — not_found, до проверки прав не идём', async () => {
    const { prisma, findFirst } = makePrisma({ doc: null });
    expect(await setDocumentNumber(prisma, admin(), { documentId: 'нет', number: 'СЧ-7' })).toEqual(
      {
        ok: false,
        error: 'not_found',
      }
    );
    expect(canReadDocument).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('чужой документ — тоже not_found, а НЕ forbidden', async () => {
    const { prisma, $transaction } = makePrisma();
    canReadDocument.mockResolvedValue(false);
    // forbidden означал бы «такой документ есть, но он не ваш» — это уже утечка:
    // по ответу можно перебрать чужие идентификаторы. Скоуп тот же, что у скачивания.
    expect(
      await setDocumentNumber(prisma, manager(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({ ok: false, error: 'not_found' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('документу с номером номер не переписывают: number_present', async () => {
    const { prisma, $transaction, findFirst } = makePrisma({ doc: doc1c({ number: 'СЧ-1' }) });
    // Номер выпущенного нами документа напечатан в PDF и стоит в имени файла:
    // правка в базе развела бы бумагу и запись.
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: false,
      error: 'number_present',
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('документ-сирота без компании — not_found: занятость номера проверять не с чем', async () => {
    const { prisma, findFirst } = makePrisma({ doc: doc1c({ companyId: null, order: null }) });
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('заказ без компании тоже оставляет документ сиротой', async () => {
    const { prisma, findFirst } = makePrisma({
      doc: doc1c({ companyId: null, orderId: 'ord-1', order: { companyId: null } }),
    });
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('setDocumentNumber — занятость номера', () => {
  it('такой же номер у документа той же компании — number_taken', async () => {
    const { prisma, $transaction } = makePrisma({ clash: { id: 'doc-2' } });
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: false,
      error: 'number_taken',
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('ищем по типу, номеру и версии — иначе счёт и акт мешали бы друг другу', async () => {
    const { prisma, findFirst } = makePrisma({ doc: doc1c({ type: 'act', version: 2 }) });
    await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' });
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({
      type: 'act',
      number: 'СЧ-7',
      version: 2,
    });
  });

  it('компания берётся «эффективная»: поле документа ИЛИ компания его заказа', async () => {
    // У документа заказа собственного companyId может не быть — компания
    // висит на заказе. Проверка только по полю документа тогда пропустила бы
    // дубль номера внутри одной и той же компании.
    const { prisma, findFirst } = makePrisma({
      doc: doc1c({ companyId: null, orderId: 'ord-1', order: { companyId: 'co-B' } }),
    });
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: true,
    });
    expect(findFirst.mock.calls[0]![0].where.OR).toEqual([
      { companyId: 'co-B' },
      { order: { companyId: 'co-B' } },
    ]);
  });

  it('своё поле companyId сильнее компании заказа и тоже ищет по обеим сторонам', async () => {
    const { prisma, findFirst } = makePrisma({
      doc: doc1c({ companyId: 'co-A', orderId: 'ord-1', order: { companyId: 'co-B' } }),
    });
    await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' });
    expect(findFirst.mock.calls[0]![0].where.OR).toEqual([
      { companyId: 'co-A' },
      { order: { companyId: 'co-A' } },
    ]);
  });
});

describe('setDocumentNumber — успех', () => {
  it('номер и запись в журнал пишутся ОДНОЙ транзакцией', async () => {
    const { prisma, tx, update, $transaction } = makePrisma();
    expect(
      await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' })
    ).toEqual({
      ok: true,
    });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { number: 'СЧ-7' } });
    // Журнал пишется тем же tx: иначе при откате обновления в журнале осталась
    // бы запись о номере, которого у документа нет.
    expect(recordAudit).toHaveBeenCalledWith(tx, expect.anything());
    expect(recordAudit.mock.calls[0]![1]).toMatchObject({
      userId: 'a1',
      action: 'document_number_set',
      entity: 'document',
      entityId: 'doc-1',
      after: { number: 'СЧ-7' },
    });
  });

  it('документ читается узким селектом и по своему id', async () => {
    const { prisma, findUnique } = makePrisma();
    await setDocumentNumber(prisma, admin(), { documentId: 'doc-1', number: 'СЧ-7' });
    const arg = findUnique.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: 'doc-1' });
    // Компания заказа нужна для «эффективной компании», counterparty* — чтобы
    // canReadDocument не ходил в базу второй раз за теми же полями.
    expect(arg.select).toMatchObject({
      number: true,
      type: true,
      version: true,
      companyId: true,
      order: { select: { companyId: true } },
    });
  });
});
