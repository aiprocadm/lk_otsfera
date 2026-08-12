import { describe, it, expect, vi } from 'vitest';
import { collectNewCounterparties } from '@/lib/services/import/oneCAccountCard/new-counterparties';

/**
 * `У-52`: предпросмотр обязан показать, кого в системе ещё нет, ДО применения.
 * Тот же список станет списком автосоздания в PR-3, поэтому условие проверяем
 * ровно то, что требует ТЗ: валидный ИНН И организации с таким ИНН нет.
 */
const VALID_A = '7707083893';
const VALID_B = '7736207543';

function db(existingInns: string[] = []) {
  const findMany = vi.fn().mockResolvedValue(existingInns.map((inn) => ({ inn })));
  return { prisma: { organization: { findMany } } as never, findMany };
}

function row(inn: string | null, name: string | null = 'ООО «Ромашка»') {
  return { counterpartyInn: inn, counterpartyName: name };
}

describe('collectNewCounterparties (У-52)', () => {
  it('оставляет только валидные ИНН, которых нет в системе', async () => {
    const { prisma, findMany } = db([VALID_B]);
    const res = await collectNewCounterparties(prisma, [
      row(VALID_A, 'ООО «Альфа»'),
      row(VALID_B, 'ООО «Бета»'), // уже есть в системе
      row('1234567890', 'ООО «Кривой ИНН»'), // контрольная сумма не сходится
      row(null, 'ООО «Без ИНН»'),
    ]);
    expect(res).toEqual([{ name: 'ООО «Альфа»', inn: VALID_A, rows: 1 }]);
    // Спрашиваем базу один раз списком, а не по строке на каждого контрагента.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('строки одного контрагента схлопываются в одну запись со счётчиком', async () => {
    const { prisma } = db();
    const res = await collectNewCounterparties(prisma, [
      row(VALID_A, 'ООО «Альфа»'),
      row(` ${VALID_A} `, 'ООО «Альфа»'),
      row(VALID_A, 'ООО «Альфа»'),
    ]);
    expect(res).toEqual([{ name: 'ООО «Альфа»', inn: VALID_A, rows: 3 }]);
  });

  it('имя берётся первое непустое: в выписке оно есть не в каждой строке', async () => {
    const { prisma } = db();
    const res = await collectNewCounterparties(prisma, [
      row(VALID_A, null),
      row(VALID_A, 'ООО «Альфа»'),
    ]);
    expect(res[0]).toMatchObject({ name: 'ООО «Альфа»', rows: 2 });
  });

  it('без единого валидного ИНН в базу не ходим вовсе', async () => {
    const { prisma, findMany } = db();
    expect(await collectNewCounterparties(prisma, [row(null), row('123')])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('организация без ИНН в базе не мешает сравнению', async () => {
    // `Organization.inn` необязателен: null-строки просто не участвуют.
    const findMany = vi.fn().mockResolvedValue([{ inn: null }]);
    const prisma = { organization: { findMany } } as never;
    const res = await collectNewCounterparties(prisma, [row(VALID_A, 'ООО «Альфа»')]);
    expect(res).toHaveLength(1);
  });

  it('список отсортирован по названию — человеку читать сверху вниз', async () => {
    const { prisma } = db();
    const res = await collectNewCounterparties(prisma, [
      row(VALID_A, 'Яблоко'),
      row(VALID_B, 'Апельсин'),
    ]);
    expect(res.map((c) => c.name)).toEqual(['Апельсин', 'Яблоко']);
  });
});
