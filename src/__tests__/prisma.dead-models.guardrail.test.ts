import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * `У-261` (дефект `Д-43`) — в схеме не должно быть моделей, к которым никто не
 * обращается.
 *
 * Мёртвая таблица дорога не местом на диске, а вниманием: её видно в схеме, её
 * тащат миграции, про неё спрашивают на ревью — и каждый раз кто-то заново
 * выясняет, что она ничего не делает. Так в репозитории прожил `SavedView`.
 *
 * **Почему страж сложнее, чем `grep 'prisma.model'`.** Наивная проверка
 * объявила бы мёртвыми три совершенно живые модели, и это не догадка — так и
 * вышло при разборе:
 *
 *   - `DocumentLine` пишется **вложенно**: `lines: { create: … }` у документа;
 *   - `StaffParticipant` — так же, через `participants: { … }`;
 *   - `DocumentNumberingBackup` пишется **сырым SQL**:
 *     `INSERT INTO "DocumentNumberingBackup"`.
 *
 * Поэтому модель считается живой, если в боевом коде (без `src/__tests__`)
 * найдено ХОТЬ ОДНО из трёх доказательств:
 *
 *   1. обращение через клиент — `prisma.x` / `tx.x` / `db.x` / `client.x`;
 *   2. имя таблицы в кавычках внутри строки — признак сырого SQL;
 *   3. имя поля-связи, **указывающего на эту модель**, как ключ объекта.
 *
 * Третий канал намеренно мягкий: слово `lines:` встречается и в другом смысле.
 * Страж ловит **новую** мёртвую модель, и ложное «живая» здесь — пропуск, а не
 * красная сборка на ровном месте. Цена ошибки несимметрична: пропущенная
 * мёртвая модель стоит одного лишнего разбора, а страж, краснеющий на каждом
 * втором PR, будет просто выключен.
 *
 * **Тесты в доказательства не идут.** Модель, которую трогает только уборка в
 * `afterAll`, мертва для продукта — именно так выглядел `SavedView`.
 */
const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Модели, которым разрешено не иметь обращений. Список **пуст** и должен таким
 * остаться: если модель нужна только базе, её место — в миграции, а не в схеме
 * Prisma.
 */
const ALLOWED_DEAD: string[] = [];

type Schema = {
  models: string[];
  /** Модель → имена полей-связей, которые на неё указывают (из любых моделей). */
  incomingFields: Map<string, Set<string>>;
};

function parseSchema(): Schema {
  // `.prisma` — не код продукта: читаем как есть, снятие `//` тут ни к чему.
  // Путь пишется прямо в вызове, а не через переменную: страж-над-стражами
  // (`guards.source-read-strips-comments`) отличает чтение кода от чтения
  // не-кода по ТЕКСТУ вызова, и `readFileSync(SCHEMA, …)` для него выглядит
  // как чтение исходника в обход помощника.
  const text = readFileSync(join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const models = [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1] as string);
  const known = new Set(models);
  const incomingFields = new Map<string, Set<string>>();
  for (const name of models) incomingFields.set(name, new Set());

  for (const block of text.split(/^model\s+\w+\s*\{/m).slice(1)) {
    const body = block.split(/^\}/m)[0] ?? '';
    for (const line of body.split('\n')) {
      const m = /^\s*(\w+)\s+(\w+)(\[\])?\??/.exec(line);
      if (!m) continue;
      const [, field, type] = m;
      if (!field || !type || !known.has(type)) continue;
      incomingFields.get(type)?.add(field);
    }
  }
  return { models, incomingFields };
}

/** Весь боевой код одной строкой. Тесты исключены намеренно (см. шапку). */
function productionSource(): string {
  const chunks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'e2e') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith('.ts') || full.endsWith('.tsx')) chunks.push(readSource(full));
    }
  };
  walk(join(REPO_ROOT, 'src'));
  return chunks.join('\n');
}

function camel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const schema = parseSchema();
const source = productionSource();

/** Какие доказательства жизни нашлись у модели. */
function evidence(model: string): string[] {
  const found: string[] = [];
  const c = escape(camel(model));

  if (new RegExp(`(?:prisma|tx|db|client)\\.${c}\\b`).test(source))
    found.push('обращение к модели');
  if (source.includes(`"${model}"`)) found.push('имя таблицы в сыром SQL');

  for (const field of schema.incomingFields.get(model) ?? []) {
    if (new RegExp(`\\b${escape(field)}\\s*:`).test(source)) {
      found.push(`поле-связь «${field}»`);
      break;
    }
  }
  return found;
}

describe('схема Prisma: моделей без обращений нет (У-261)', () => {
  it('схема разобрана (иначе проверка ничего не значит)', () => {
    expect(schema.models.length, 'в schema.prisma не нашлось моделей').toBeGreaterThan(50);
    expect(source.length, 'боевой код не прочитан').toBeGreaterThan(100_000);
  });

  it('три живые модели действительно опознаются как живые', () => {
    // Закрепляем именно те случаи, на которых наивный grep ошибался. Если
    // однажды канал доказательств сломается, красным станет этот тест, а не
    // тот, что перечисляет мёртвые модели, — и станет сразу понятно, ЧТО
    // сломалось.
    for (const model of ['DocumentLine', 'StaffParticipant', 'DocumentNumberingBackup']) {
      expect(evidence(model), `${model} ошибочно признана мёртвой`).not.toEqual([]);
    }
  });

  it('ни одной модели без доказательств жизни', () => {
    const dead = schema.models
      .filter((m) => !ALLOWED_DEAD.includes(m))
      .filter((m) => evidence(m).length === 0);

    expect(
      dead,
      'Эти модели Prisma нигде не используются боевым кодом:\n' +
        dead.map((m) => `  - ${m}`).join('\n') +
        '\n\nЛибо удалите модель и таблицу (отдельным PR, после `npm run report:dead-tables`),\n' +
        'либо найдите ей применение. Список исключений намеренно пуст.'
    ).toEqual([]);
  });

  it('список исключений пуст', () => {
    expect(
      ALLOWED_DEAD,
      'Исключение здесь означает «таблица нужна, но никто её не трогает» — такого не бывает.'
    ).toEqual([]);
  });
});
