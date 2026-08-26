import { describe, it, expect } from 'vitest';
import { CRON_PRESETS, nextCronRuns, parseCron } from '@/lib/jobs/cron';
import { DEFAULT_SYNC_TZ, SYNC_SCHEDULES } from '@/lib/jobs/scheduling';

/**
 * `У-125`: расписание задаётся в интерфейсе, поэтому разбор обязан быть
 * строгим (принять то, что планировщик отвергнет, — значит тихо остановить
 * обмен) и предсказуемым (человек сверяет свои три ближайшие даты).
 */

const MSK = DEFAULT_SYNC_TZ;
/** 26.08.2026, 13:07 по Москве (10:07 UTC). */
const NOW = new Date('2026-08-26T10:07:00Z');

function runs(expr: string, count = 3): string[] {
  return nextCronRuns(expr, MSK, NOW, count).map((d) => d.toISOString());
}

describe('parseCron — что принимаем', () => {
  it('звёздочки во всех полях', () => {
    const r = parseCron('* * * * *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.minutes).toHaveLength(60);
    expect(r.fields.hours).toHaveLength(24);
    expect(r.fields.domRestricted).toBe(false);
    expect(r.fields.dowRestricted).toBe(false);
  });

  it('шаг, диапазон и список', () => {
    const r = parseCron('0,30 9-17/4 * * *');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields.minutes).toEqual([0, 30]);
    expect(r.fields.hours).toEqual([9, 13, 17]);
  });

  it('шаг от конкретного значения идёт до конца диапазона', () => {
    const r = parseCron('5/20 * * * *');
    expect(r.ok && r.fields.minutes).toEqual([5, 25, 45]);
  });

  it('воскресенье пишется и как 0, и как 7', () => {
    const a = parseCron('0 0 * * 0');
    const b = parseCron('0 0 * * 7');
    expect(a.ok && a.fields.daysOfWeek).toEqual([0]);
    expect(b.ok && b.fields.daysOfWeek).toEqual([0]);
  });

  it('все пресеты формы разбираются', () => {
    for (const p of CRON_PRESETS) {
      expect(parseCron(p.value).ok, `${p.label}: ${p.value}`).toBe(true);
    }
  });

  it('все расписания, зашитые в коде, разбираются', () => {
    // Иначе форма показала бы «ошибка» на том, что уже работает.
    for (const s of SYNC_SCHEDULES) {
      expect(parseCron(s.pattern).ok, `${s.schedulerId}: ${s.pattern}`).toBe(true);
    }
  });
});

describe('parseCron — что отвергаем (и почему это правильно)', () => {
  const bad: Array<[string, string]> = [
    ['', 'пусто'],
    ['* * * *', 'четыре поля'],
    ['* * * * * *', 'шесть полей'],
    ['60 * * * *', 'минута вне диапазона'],
    ['* 24 * * *', 'час вне диапазона'],
    ['* * 0 * *', 'нулевой день месяца'],
    ['* * * 13 *', 'тринадцатый месяц'],
    ['* * * * 8', 'восьмой день недели'],
    ['10-5 * * * *', 'диапазон задом наперёд'],
    ['*/0 * * * *', 'нулевой шаг'],
    ['*/a * * * *', 'шаг не число'],
    ['0 * * * MON', 'имя дня недели — планировщик поймёт, мы намеренно нет'],
    ['0 0 ? * *', 'вопросительный знак'],
    ['0 0 L * *', 'последний день месяца'],
    ['1,,2 * * * *', 'пустой элемент списка'],
    ['1/2/3 * * * *', 'лишняя косая черта'],
  ];

  for (const [expr, why] of bad) {
    it(`«${expr}» → отказ (${why})`, () => {
      const r = parseCron(expr);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.length, 'причина отказа обязана быть внятной').toBeGreaterThan(5);
    });
  }
});

describe('nextCronRuns — предпросмотр', () => {
  it('каждые 15 минут: три ближайших с шагом 15', () => {
    expect(runs('*/15 * * * *')).toEqual([
      '2026-08-26T10:15:00.000Z',
      '2026-08-26T10:30:00.000Z',
      '2026-08-26T10:45:00.000Z',
    ]);
  });

  it('каждый час: ровно в ноль минут', () => {
    expect(runs('0 * * * *')).toEqual([
      '2026-08-26T11:00:00.000Z',
      '2026-08-26T12:00:00.000Z',
      '2026-08-26T13:00:00.000Z',
    ]);
  });

  it('раз в сутки в 3:00 по Москве — это 00:00 UTC', () => {
    // Пояс учитывается: иначе человек увидел бы 3:00 UTC, то есть 6 утра.
    expect(runs('0 3 * * *')).toEqual([
      '2026-08-27T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
      '2026-08-29T00:00:00.000Z',
    ]);
  });

  it('раз в 6 часов: ближайшие границы, а не «через 6 часов от сейчас»', () => {
    expect(runs('0 */6 * * *')).toEqual([
      '2026-08-26T15:00:00.000Z',
      '2026-08-26T21:00:00.000Z',
      '2026-08-27T03:00:00.000Z',
    ]);
  });

  it('по понедельникам — все три даты понедельники', () => {
    const got = nextCronRuns('0 9 * * 1', MSK, NOW, 3);
    expect(got).toHaveLength(3);
    for (const d of got) {
      const dow = new Intl.DateTimeFormat('en-US', { timeZone: MSK, weekday: 'short' }).format(d);
      expect(dow).toBe('Mon');
    }
  });

  it('момент «прямо сейчас» в список не попадает', () => {
    // Иначе первая строка предпросмотра была бы уже прошедшей.
    const exact = new Date('2026-08-26T10:15:00Z');
    expect(nextCronRuns('*/15 * * * *', MSK, exact, 1)[0]?.toISOString()).toBe(
      '2026-08-26T10:30:00.000Z'
    );
  });

  it('даты идут строго по возрастанию', () => {
    const got = nextCronRuns('0 0,12 1,15 * *', MSK, NOW, 5).map((d) => d.getTime());
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });

  it('оба дневных поля ограничены — правило ИЛИ, как в самом cron', () => {
    // 1-е число ИЛИ понедельник. Не «первое число, если это понедельник».
    const got = nextCronRuns('0 9 1 * 1', MSK, NOW, 4);
    expect(got.length).toBe(4);
    const marks = got.map((d) => {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: MSK,
        day: 'numeric',
        weekday: 'short',
      }).formatToParts(d);
      const day = p.find((x) => x.type === 'day')?.value;
      const dow = p.find((x) => x.type === 'weekday')?.value;
      return day === '1' || dow === 'Mon';
    });
    expect(marks.every(Boolean)).toBe(true);
  });

  it('неразобранное выражение даёт пустой список, а не выдуманные даты', () => {
    expect(nextCronRuns('0 0 L * *', MSK, NOW, 3)).toEqual([]);
  });

  it('никогда не срабатывающее выражение не зацикливается', () => {
    // 30 февраля не наступает никогда — поиск обязан закончиться.
    expect(nextCronRuns('0 0 30 2 *', MSK, NOW, 3)).toEqual([]);
  });
});
