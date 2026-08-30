import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  listCompanyTemplates,
  resetCompanyTemplate,
  saveCompanyTemplate,
} from '@/lib/services/documents/templates';

/**
 * Этап 6, PR-7 (`У-160`) — свои тексты абзацев договора на ЖИВОМ Postgres.
 *
 * Фейковая prisma принимает любые данные: у неё нет ни ограничений таблицы, ни
 * блокировок строк. Поэтому здесь проверяется ровно то, что живёт в базе, а не
 * в коде сервиса:
 *
 * 1. **Ограничения `DocumentTemplate_body_not_blank` и `_revision_positive`** —
 *    «нет своего текста» выражается ОТСУТСТВИЕМ строки, а не пустой строкой, и
 *    редакция 0 зарезервирована за смыслом «печатали встроенным текстом».
 *    Мимо сервиса (напрямую `create`) такую строку записать всё равно нельзя.
 * 2. **Составной ключ `(companyId, slot)`** — у абзаца одна строка на компанию.
 * 3. **Номер редакции при одновременных правках** — главный тест файла. Счётчик
 *    компании крутится внутри транзакции, поэтому два параллельных сохранения
 *    получают РАЗНЫЕ номера. Будь это «прочитали — записали», оба увидели бы
 *    одно и то же число, и два разных текста стали бы неразличимы в уже
 *    выпущенных документах.
 * 4. **Каскад** — у удалённой компании собственных текстов остаться не может.
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string;
let leaderId: string;
/** Компании, созданные тестами по ходу дела: убираются в `afterAll` вслед за своими. */
const extraCompanies: string[] = [];

const sLeader = (): SessionPayload =>
  ({ sub: leaderId, role: 'leader', companyId: companyA }) as unknown as SessionPayload;

/** Текст ошибки базы в читаемом виде: имя нарушенного ограничения нам и нужно. */
async function dbErrorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('база приняла запись, которую обязана была отвергнуть');
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `s6p7-co-${STAMP}` } })).id;
  leaderId = (
    await prisma.user.create({
      data: {
        email: `s6p7-l-${STAMP}@t.local`,
        name: 'Руководитель',
        role: 'leader',
        companyId: companyA,
      },
    })
  ).id;
});

afterAll(async () => {
  const companies = [companyA, ...extraCompanies];
  await prisma.documentTemplate.deleteMany({ where: { companyId: { in: companies } } });
  // Журнал ссылается на пользователя внешним ключом — снимаем его до удаления.
  await prisma.auditLog.deleteMany({ where: { userId: leaderId } });
  await prisma.user.deleteMany({ where: { id: leaderId } });
  await prisma.company.deleteMany({ where: { id: { in: companies } } });
  await prisma.$disconnect();
});

describe('шаблоны текстов договора на живой базе (`У-160`)', () => {
  it('ограничения таблицы: пустой текст и редакция меньше единицы в базу не попадают', async () => {
    // Одни пробелы — это не «свой текст», а отказ от него. Сервис такое
    // отсекает раньше, но ограничение стоит в самой таблице: строка мимо
    // сервиса (миграция, ручная правка, чужой код) тоже не пройдёт.
    const blank = await dbErrorOf(() =>
      prisma.documentTemplate.create({
        data: { companyId: companyA, slot: 'payment', body: '     ', revision: 1 },
      })
    );
    expect(blank).toMatch(/body_not_blank/);

    // Ограничение базы понимает «пусто» как одни ПРОБЕЛЫ (`btrim`), поэтому
    // текст из табуляций и переводов строки отбивает сервис — до базы он не
    // доходит вовсе.
    expect(
      await saveCompanyTemplate(prisma, sLeader(), {
        companyId: companyA,
        slot: 'payment',
        body: '\t\n \n',
      })
    ).toEqual({ ok: false, error: 'text_empty' });

    // Ноль занят смыслом «документ напечатан встроенным текстом»
    // (`Document.templateVersion`), поэтому редакцией строки он быть не может.
    const zero = await dbErrorOf(() =>
      prisma.documentTemplate.create({
        data: { companyId: companyA, slot: 'payment', body: 'Оплата по счёту.', revision: 0 },
      })
    );
    expect(zero).toMatch(/revision_positive/);

    // Ни одна из двух попыток не оставила следа: слот по-прежнему свободен.
    expect(await prisma.documentTemplate.count({ where: { companyId: companyA } })).toBe(0);
  });

  it('составной ключ (companyId, slot): второй строки того же абзаца быть не может', async () => {
    await prisma.documentTemplate.create({
      data: { companyId: companyA, slot: 'deadline', body: 'Сроки — по заявке.', revision: 1 },
    });

    const dup = await dbErrorOf(() =>
      prisma.documentTemplate.create({
        data: { companyId: companyA, slot: 'deadline', body: 'Другой текст.', revision: 2 },
      })
    );
    // P2002 — нарушение уникальности. Без него у абзаца оказалось бы два
    // «действующих» текста, и печать выбирала бы между ними наугад.
    expect(dup).toMatch(/P2002|Unique constraint/i);

    // Тот же слот у СОСЕДНЕЙ компании — законная строка: ключ составной.
    const other = (await prisma.company.create({ data: { name: `s6p7-co2-${STAMP}` } })).id;
    extraCompanies.push(other);
    await prisma.documentTemplate.create({
      data: { companyId: other, slot: 'deadline', body: 'Сроки соседа.', revision: 1 },
    });

    const rows = await prisma.documentTemplate.findMany({ where: { slot: 'deadline' } });
    expect(rows.filter((r) => r.companyId === companyA)).toHaveLength(1);
    expect(rows.filter((r) => r.companyId === other)).toHaveLength(1);

    await prisma.documentTemplate.deleteMany({ where: { companyId: companyA } });
  });

  it('два одновременных сохранения разных абзацев получают РАЗНЫЕ номера редакций', async () => {
    const before = await prisma.company.findUniqueOrThrow({
      where: { id: companyA },
      select: { documentTemplateRevision: true },
    });

    // Оба сохранения стартуют одновременно и крутят один и тот же счётчик
    // компании. Атомарный `increment` внутри транзакции заставляет второе
    // подождать первое; «прочитали — записали» выдал бы им один номер.
    const [payment, liability] = await Promise.all([
      saveCompanyTemplate(prisma, sLeader(), {
        companyId: companyA,
        slot: 'payment',
        body: 'Оплата — 100% предоплата в течение 3 рабочих дней.',
      }),
      saveCompanyTemplate(prisma, sLeader(), {
        companyId: companyA,
        slot: 'liability',
        body: 'Стороны отвечают по закону, штраф не более 10% от суммы.',
      }),
    ]);

    expect(payment.ok).toBe(true);
    expect(liability.ok).toBe(true);
    if (!payment.ok || !liability.ok) return;
    expect(payment.revision).not.toBe(liability.revision);
    // Номера идут подряд от прежнего значения счётчика: ни один не пропущен и
    // ни один не выдан дважды.
    expect([payment.revision, liability.revision].sort((a, b) => a - b)).toEqual([
      before.documentTemplateRevision + 1,
      before.documentTemplateRevision + 2,
    ]);

    const after = await prisma.company.findUniqueOrThrow({
      where: { id: companyA },
      select: { documentTemplateRevision: true },
    });
    expect(after.documentTemplateRevision).toBe(before.documentTemplateRevision + 2);

    // Выданный номер лежит в той же строке, что и текст: «в документе одна
    // редакция, а напечатана другая» невыразимо.
    const saved = await prisma.documentTemplate.findMany({
      where: { companyId: companyA },
      select: { slot: true, revision: true, body: true, updatedBy: true },
    });
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.slot === 'payment')).toMatchObject({
      revision: payment.revision,
      updatedBy: leaderId,
    });
    expect(saved.find((r) => r.slot === 'liability')?.revision).toBe(liability.revision);

    // Экран показывает свои тексты поверх встроенных — и делает это по тем же
    // строкам, что записала транзакция.
    const list = await listCompanyTemplates(prisma, sLeader(), companyA);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.rows.find((r) => r.slot === 'payment')).toMatchObject({
      isCustom: true,
      revision: payment.revision,
    });
    expect(list.rows.find((r) => r.slot === 'deadline')?.isCustom).toBe(false);
  });

  it('повторное сохранение того же абзаца обновляет строку, а не заводит вторую', async () => {
    const res = await saveCompanyTemplate(prisma, sLeader(), {
      companyId: companyA,
      slot: 'payment',
      body: 'Оплата — 50% предоплата, 50% по акту.',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Составной ключ работает и изнутри сервиса: upsert попал в существующую
    // строку, поэтому текст один, а номер редакции — новый.
    const rows = await prisma.documentTemplate.findMany({
      where: { companyId: companyA, slot: 'payment' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain('50% по акту');
    expect(rows[0]!.revision).toBe(res.revision);
  });

  it('«вернуть стандартный» удаляет строку и всё равно двигает счётчик компании', async () => {
    const before = await prisma.company.findUniqueOrThrow({
      where: { id: companyA },
      select: { documentTemplateRevision: true },
    });

    expect(
      await resetCompanyTemplate(prisma, sLeader(), { companyId: companyA, slot: 'payment' })
    ).toEqual({
      ok: true,
    });

    // Копии встроенного текста в базе не остаётся: строки просто нет.
    expect(
      await prisma.documentTemplate.count({ where: { companyId: companyA, slot: 'payment' } })
    ).toBe(0);
    // Соседний абзац сбросом не задет — удаление адресное.
    expect(
      await prisma.documentTemplate.count({ where: { companyId: companyA, slot: 'liability' } })
    ).toBe(1);

    const after = await prisma.company.findUniqueOrThrow({
      where: { id: companyA },
      select: { documentTemplateRevision: true },
    });
    // Счётчик растёт и на сбросе: документы «до» и «до возврата к стандартному»
    // не должны выглядеть одинаково в журнале.
    expect(after.documentTemplateRevision).toBe(before.documentTemplateRevision + 1);

    // Повторный сброс уже отсутствующей строки — не ошибка, но номер съедает:
    // номера не переиспользуются никогда.
    expect(
      await resetCompanyTemplate(prisma, sLeader(), { companyId: companyA, slot: 'payment' })
    ).toEqual({
      ok: true,
    });
    const twice = await prisma.company.findUniqueOrThrow({
      where: { id: companyA },
      select: { documentTemplateRevision: true },
    });
    expect(twice.documentTemplateRevision).toBe(before.documentTemplateRevision + 2);

    // И сохранение, и сброс писали в журнал — событие видно расследованию.
    const actions = await prisma.auditLog.findMany({
      where: { entity: 'document_template', entityId: companyA },
      select: { action: true },
    });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set(['document_template_changed', 'document_template_reset'])
    );
  });

  it('каскад: удаление компании уносит её тексты абзацев', async () => {
    const doomed = (await prisma.company.create({ data: { name: `s6p7-doomed-${STAMP}` } })).id;
    extraCompanies.push(doomed);
    await prisma.documentTemplate.create({
      data: { companyId: doomed, slot: 'misc', body: 'Особые условия компании.', revision: 1 },
    });

    await prisma.company.delete({ where: { id: doomed } });

    // Осиротевший текст договора несуществующей компании — мусор, который
    // однажды напечатался бы в чужой бумаге.
    expect(await prisma.documentTemplate.count({ where: { companyId: doomed } })).toBe(0);
  });

  it('внешний ключ: текст нельзя привязать к компании, которой нет', async () => {
    // Сервис проверяет наличие компании до транзакции, но последней преградой
    // остаётся сама база: 500 из-за битой ссылки быть не должно.
    const orphan = await dbErrorOf(() =>
      prisma.documentTemplate.create({
        data: { companyId: `нет-такой-${STAMP}`, slot: 'payment', body: 'Текст.', revision: 1 },
      })
    );
    expect(orphan).toMatch(/P2003|Foreign key/i);

    expect(
      await saveCompanyTemplate(
        prisma,
        { sub: leaderId, role: 'admin' } as unknown as SessionPayload,
        {
          companyId: `нет-такой-${STAMP}`,
          slot: 'payment',
          body: 'Текст.',
        }
      )
    ).toEqual({ ok: false, error: 'not_found' });
  });
});
