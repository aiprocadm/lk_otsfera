import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ `У-257` (`Р-Э8-6`): сверка дебиторки **ничего не правит**.
 *
 * Соблазн «раз уж мы нашли расхождение — давайте поправим» появится ровно в
 * тот день, когда расхождений станет много. Цена ошибки здесь не как у списка:
 * тихая автоправка денег однажды перепишет верную цифру неверной, и виноватого
 * не найдут — в журнале будет стоять «обмен с 1С».
 *
 * Поэтому правило записано не только в комментарии: файлы сверки и отчёта не
 * имеют права писать в базу вообще. Читать — сколько угодно.
 *
 * Мутация (проверено, пять поломок): дописать `prisma.order.update` в сверку;
 * дописать в неё `$executeRaw`; дописать `order.updateMany` в отчёт; обнулить
 * порог расхождения; убрать запись строки в историю обмена — все пять
 * краснеют.
 */
const SRC = join(process.cwd(), 'src');

/** Файлы, которым разрешено только читать. */
const READ_ONLY = [
  'lib/services/oneCSync/reconcileDebts.ts',
  'lib/services/oneCSync/debtsReport.ts',
  'lib/services/oneCSync/debtMismatches.ts',
];

/**
 * Записывающие обращения Prisma. `syncLog.create` — единственное законное
 * исключение: сверка обязана оставить след в истории обмена, и он идёт через
 * `writeSyncLog`, а не прямым вызовом.
 */
const WRITE_CALLS = [
  /\.order\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/,
  /\.payment\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/,
  /\.document\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/,
  /\.organization\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/,
  /\$executeRaw/,
  /\$transaction/,
];

describe('страж: сверка дебиторки только показывает (У-257, Р-Э8-6)', () => {
  it.each(READ_ONLY)('%s не пишет в базу', (rel) => {
    const source = readSource(join(SRC, rel));
    for (const pattern of WRITE_CALLS) {
      expect(
        pattern.test(source),
        `${rel}: появилась запись в базу (${pattern}) — сверка обязана только показывать расхождение`
      ).toBe(false);
    }
  });

  it('сверка всё-таки оставляет след — иначе показывать будет нечего', () => {
    // Обратная сторона правила: «ничего не пишет» не должно означать «молчит».
    const source = readSource(join(SRC, 'lib/services/oneCSync/reconcileDebts.ts'));
    expect(source, 'сверка перестала писать строку в историю обмена').toContain('writeSyncLog(');
  });

  it('порог расхождения задан явно и равен рублю', () => {
    // `В-8-3`: копеечные расхождения округления в отчёт не попадают. Значение
    // важнее имени: подменив 1 на 0, мы завалили бы отчёт шумом.
    const source = readSource(join(SRC, 'lib/services/oneCSync/reconcileDebts.ts'));
    expect(source).toMatch(/DEBT_MISMATCH_THRESHOLD\s*=\s*1\b/);
  });

  it('«метод не подключён» отличается от «1С не отвечает»', () => {
    // Иначе администратор будет чинить работающий обмен, пока 1С не реализует
    // метод. Разные коды — разные действия человека.
    const source = readSource(join(SRC, 'lib/services/oneCSync/reconcileDebts.ts'));
    expect(source).toContain('not_implemented');
    expect(source).toContain('transport');
    expect(source).toContain('OneCMethodNotImplementedError');
  });
});
