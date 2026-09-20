import { describe, it, expect, vi } from 'vitest';
import * as scheduling from '@/lib/jobs/scheduling';

/**
 * Реестр `ALL_SCHEDULES` обязан содержать **каждое** расписание, которое
 * система реально регистрирует.
 *
 * **Как это случилось.** Расписание повторяющихся задач
 * (`tasks.recurrence.cron`) завели вместе со своей функцией регистрации, а в
 * реестр добавить забыли. Ни один тест не падал: реестр читается только ради
 * **редактируемых** расписаний, а это — нередактируемое. Наружу дефект выходил
 * тихо: `defaultPatternFor('tasks.recurrence.cron')` отвечал «такой задачи
 * нет» про живую задачу, а имя ALL_SCHEDULES переставало быть правдой.
 * Найдено 20.09.2026 при погашении долга покрытия.
 *
 * **Почему проверка поведенческая, а не по тексту.** Можно было сверять
 * список констант в исходнике, но тогда страж ловил бы переименование, а не
 * пропажу. Здесь вызываются все функции регистрации с поддельной очередью, и
 * сверяется то, что система **действительно** ставит в расписание.
 */
type Registered = { schedulerId: string };

/** Поддельная очередь: запоминает, что в неё поставили. */
function fakeGetQueue() {
  return vi.fn(() => ({ upsertJobScheduler: vi.fn(async () => undefined) })) as never;
}

/** Все функции регистрации расписаний модуля. */
const REGISTRARS = Object.entries(scheduling).filter(
  ([name, value]) =>
    name.startsWith('register') && name.endsWith('Schedules') && typeof value === 'function'
) as Array<[string, (q: never) => Promise<Registered[]>]>;

describe('ALL_SCHEDULES содержит все зарегистрированные расписания', () => {
  it('функции регистрации вообще найдены — иначе страж молчал бы впустую', () => {
    // Без этой проверки переименование `register*Schedules` превратило бы
    // список в пустой, и тест стал бы вечно зелёным ни о чём.
    expect(REGISTRARS.length).toBeGreaterThanOrEqual(8);
  });

  it('каждое поставленное расписание есть в реестре', async () => {
    const known = new Set(scheduling.ALL_SCHEDULES.map((s) => s.schedulerId));
    const missing: string[] = [];

    for (const [name, register] of REGISTRARS) {
      const rows = await register(fakeGetQueue());
      for (const row of rows) {
        if (!known.has(row.schedulerId)) missing.push(`${row.schedulerId} (из ${name})`);
      }
    }

    expect(
      missing,
      'Эти расписания система ставит, но в ALL_SCHEDULES их нет:\n' +
        missing.map((m) => `  ${m}`).join('\n') +
        '\n\nДобавьте их в ALL_SCHEDULES с нужным `editable`. Иначе ' +
        '`defaultPatternFor` отвечает «такой задачи нет» про живую задачу.'
    ).toEqual([]);
  });

  it('у каждой задачи реестра есть расписание по умолчанию', () => {
    const broken = scheduling.ALL_SCHEDULES.filter(
      (s) => scheduling.defaultPatternFor(s.schedulerId) !== s.pattern
    ).map((s) => s.schedulerId);

    expect(broken, `Реестр и defaultPatternFor разошлись: ${broken.join(', ')}`).toEqual([]);
  });
});
