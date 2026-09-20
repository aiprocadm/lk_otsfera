/**
 * `У-251` (этап 8) — правило замены версии загруженного документа.
 *
 * Проверяется поведение, а не наличие функции: кому можно заменить файл, что
 * считается «тем же документом» и как собирается цепочка версий.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument } = vi.hoisted(() => ({ canReadDocument: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));

import {
  resolveReplaces,
  canReplaceUploader,
  getVersionChain,
} from '@/lib/services/documents/versions';

const staff = { sub: 'u1', role: 'manager' } as SessionPayload;
const client = { sub: 'u2', role: 'organization' } as SessionPayload;

const PREV = {
  id: 'doc1',
  version: 2,
  type: 'invoice',
  status: 'issued',
  direction: 'incoming',
  counterpartyType: 'organization',
  counterpartyId: 'org1',
  orderId: 'ord1',
  companyId: null,
  number: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  generatedBy: 'user',
  supersededAt: null,
  uploadedBy: { role: 'organization' },
  order: { companyId: 'co1' },
};

const INCOMING = {
  docType: 'invoice',
  counterparty: { type: 'organization' as const, id: 'org1' },
  orderId: 'ord1',
};

function db(doc: unknown) {
  return {
    document: { findUnique: vi.fn().mockResolvedValue(doc) },
  } as unknown as PrismaClient;
}

describe('resolveReplaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadDocument.mockResolvedValue(true);
  });

  it('без идентификатора прежней версии это обычная загрузка', async () => {
    const prisma = db(null);
    const res = await resolveReplaces(prisma, staff, null, INCOMING);
    expect(res).toEqual({ ok: true, replaces: undefined });
    // В базу за прежней версией даже не ходили: незачем.
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('пустая строка идентификатора считается отсутствием, а не поиском', async () => {
    const res = await resolveReplaces(db(null), staff, '', INCOMING);
    expect(res).toEqual({ ok: true, replaces: undefined });
  });

  it('прежней версии нет — not_found', async () => {
    const res = await resolveReplaces(db(null), staff, 'doc1', INCOMING);
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('документ вне скоупа — forbidden', async () => {
    canReadDocument.mockResolvedValue(false);
    const res = await resolveReplaces(db(PREV), staff, 'doc1', INCOMING);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('клиент не заменяет файл, загруженный не его ролью', async () => {
    const staffUploaded = { ...PREV, uploadedBy: { role: 'manager' } };
    const res = await resolveReplaces(db(staffUploaded), client, 'doc1', INCOMING);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('клиент заменяет собственный загруженный файл', async () => {
    const res = await resolveReplaces(db(PREV), client, 'doc1', INCOMING);
    expect(res).toEqual({ ok: true, replaces: { id: 'doc1', version: 2 } });
  });

  it('у прежней версии автора нет (импорт из 1С) — клиенту замена закрыта', async () => {
    // Роль автора у импортированной бумаги неизвестна. Считать «автора нет»
    // за «автор — это ты» значило бы открыть клиенту замену чужих файлов.
    const noUploader = { ...PREV, uploadedBy: null };
    expect(await resolveReplaces(db(noUploader), client, 'doc1', INCOMING)).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('выпущенный в ЛК документ меняется перевыпуском, а не загрузкой', async () => {
    const generated = { ...PREV, generatedBy: 'system' };
    const res = await resolveReplaces(db(generated), staff, 'doc1', INCOMING);
    expect(res).toEqual({ ok: false, error: 'generated_document' });
  });

  it('уже заменённая версия не ветвится', async () => {
    const superseded = { ...PREV, supersededAt: new Date('2026-09-10T00:00:00Z') };
    const res = await resolveReplaces(db(superseded), staff, 'doc1', INCOMING);
    expect(res).toEqual({ ok: false, error: 'already_superseded' });
  });

  it('другой тип документа — это другой документ', async () => {
    const res = await resolveReplaces(db(PREV), staff, 'doc1', { ...INCOMING, docType: 'act' });
    expect(res).toEqual({ ok: false, error: 'mismatch' });
  });

  it('другой контрагент — это другой документ', async () => {
    const res = await resolveReplaces(db(PREV), staff, 'doc1', {
      ...INCOMING,
      counterparty: { type: 'partner', id: 'p1' },
    });
    expect(res).toEqual({ ok: false, error: 'mismatch' });
  });

  it('другой заказ — это другой документ', async () => {
    const res = await resolveReplaces(db(PREV), staff, 'doc1', { ...INCOMING, orderId: 'ord2' });
    expect(res).toEqual({ ok: false, error: 'mismatch' });
  });

  it('документ без заказа заменяется документом без заказа', async () => {
    const orderLess = { ...PREV, orderId: null };
    const res = await resolveReplaces(db(orderLess), staff, 'doc1', {
      ...INCOMING,
      orderId: null,
    });
    expect(res).toEqual({ ok: true, replaces: { id: 'doc1', version: 2 } });
  });

  it('сотрудник заменяет файл, загруженный клиентом', async () => {
    const res = await resolveReplaces(db(PREV), staff, 'doc1', INCOMING);
    expect(res).toEqual({ ok: true, replaces: { id: 'doc1', version: 2 } });
  });
});

describe('canReplaceUploader', () => {
  it('сотрудники менеджерского контура и администратор могут всегда', () => {
    expect(canReplaceUploader({ role: 'manager' } as SessionPayload, null)).toBe(true);
    expect(canReplaceUploader({ role: 'leader' } as SessionPayload, null)).toBe(true);
    expect(canReplaceUploader({ role: 'admin' } as SessionPayload, null)).toBe(true);
  });

  it('клиенту нужен загрузчик той же роли', () => {
    expect(canReplaceUploader(client, 'organization')).toBe(true);
    expect(canReplaceUploader(client, 'partner')).toBe(false);
  });

  it('неизвестный загрузчик закрывает дверь клиенту', () => {
    // Документ приехал из 1С или Битрикса: спросить «ты ли это грузил» не у кого.
    expect(canReplaceUploader(client, null)).toBe(false);
  });
});

describe('getVersionChain', () => {
  function row(id: string, version: number, replaces: string | null, superseded = false) {
    return {
      id,
      version,
      name: `file-v${version}.pdf`,
      createdAt: new Date(`2026-09-0${version}T00:00:00Z`),
      supersededAt: superseded ? new Date('2026-09-10T00:00:00Z') : null,
      replacesDocumentId: replaces,
      uploadedBy: { name: 'Иванов', email: 'i@t.local' },
    };
  }

  it('пустая цепочка, когда документа нет', async () => {
    const prisma = {
      document: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn() },
    } as unknown as PrismaClient;
    expect(await getVersionChain(prisma, 'нет')).toEqual([]);
  });

  it('собирает цепочку от самой старой версии к действующей', async () => {
    const v1 = row('d1', 1, null, true);
    const v2 = row('d2', 2, 'd1', true);
    const v3 = row('d3', 3, 'd2');
    const byId: Record<string, unknown> = { d1: v1, d2: v2, d3: v3 };
    const prisma = {
      document: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(byId[where.id] ?? null)
        ),
        findFirst: vi.fn(({ where }: { where: { replacesDocumentId: string } }) =>
          Promise.resolve(
            where.replacesDocumentId === 'd1' ? v2 : where.replacesDocumentId === 'd2' ? v3 : null
          )
        ),
      },
    } as unknown as PrismaClient;

    const chain = await getVersionChain(prisma, 'd2');
    expect(chain.map((c) => c.version)).toEqual([1, 2, 3]);
    expect(chain[0]?.uploadedByName).toBe('Иванов');
    expect(chain[2]?.supersededAt).toBeNull();
  });

  it('обрыв ссылки вверх не ломает цепочку', async () => {
    const v2 = row('d2', 2, 'ушёл');
    const prisma = {
      document: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'd2' ? v2 : null)
        ),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const chain = await getVersionChain(prisma, 'd2');
    expect(chain.map((c) => c.version)).toEqual([2]);
  });

  it('имя загрузившего берётся из почты, когда имени нет', async () => {
    const v = { ...row('d1', 1, null), uploadedBy: { name: '', email: 'i@t.local' } };
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue(v),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const chain = await getVersionChain(prisma, 'd1');
    expect(chain[0]?.uploadedByName).toBe('i@t.local');
  });

  it('загрузчика нет — прочерк вместо падения', async () => {
    const v = { ...row('d1', 1, null), uploadedBy: null };
    const prisma = {
      document: {
        findUnique: vi.fn().mockResolvedValue(v),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const chain = await getVersionChain(prisma, 'd1');
    expect(chain[0]?.uploadedByName).toBeNull();
  });

  it('кольцо ссылок не зацикливает обход', async () => {
    // Кольца в базе быть не должно, но страховка в 50 шагов обязана работать:
    // иначе один битый документ вешает карточку.
    const a = row('a', 1, 'b');
    const b = row('b', 2, 'a');
    const byId: Record<string, unknown> = { a, b };
    const prisma = {
      document: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(byId[where.id] ?? null)
        ),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    const chain = await getVersionChain(prisma, 'a');
    expect(chain.length).toBe(51);
  });
});
