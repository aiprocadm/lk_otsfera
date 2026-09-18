import { describe, it, expect } from 'vitest';
import { LEGACY_GATEWAYS } from '@/lib/navigation/legacyGateways';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * `У-263` — шлюзы не живут вечно.
 *
 * **Что такое шлюз.** Раздел переехал, а старый адрес остался и уводит на новое
 * место, чтобы сохранённая ссылка не отдала «страница не найдена». Обещание
 * полезное, но не бесплатное: каждый шлюз это файл, строка в логике меню и
 * лишний переход у человека.
 *
 * **В чём опасность.** Без даты появления шлюз живёт вечно. Через год никто не
 * помнит, когда он возник и нужен ли ещё, — и убрать его страшно. Так шлюзы
 * копятся, пока их не становится больше, чем настоящих разделов.
 *
 * Поэтому у каждого есть дата, а этот страж считает возраст и **краснеет**,
 * когда шлюз перевалил за 90 дней. Красный страж здесь — не поломка, а
 * напоминание: пора удалить (проверив, что старого пути нет в ссылках писем и
 * уведомлений) или записать, почему он остаётся дольше.
 *
 * **Про «сегодня».** Дата берётся аргументом, а не из системных часов: иначе
 * страж зеленел бы и краснел сам по себе, без единой правки кода, и в один
 * прекрасный день упал бы на чужом PR. Проверку «на самом деле сегодня» делает
 * отдельный тест в конце.
 */
const MAX_AGE_DAYS = 90;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

type Gateway = { from: string; introducedAt: string; where: string };

/** Оба реестра шлюзов в одном виде: кабинетные и разделов хаба «Настройки». */
function allGateways(): Gateway[] {
  const out: Gateway[] = LEGACY_GATEWAYS.map((g) => ({
    from: g.from,
    introducedAt: g.introducedAt,
    where: 'legacyGateways.ts',
  }));
  for (const section of SETTINGS_SECTIONS) {
    for (const legacy of section.legacyHrefs) {
      out.push({
        from: legacy.from,
        introducedAt: legacy.introducedAt,
        where: `settings.ts → ${section.id}`,
      });
    }
  }
  return out;
}

/** Возраст в днях на указанную дату. */
function ageInDays(introducedAt: string, today: Date): number {
  const born = new Date(`${introducedAt}T00:00:00Z`);
  return Math.floor((today.getTime() - born.getTime()) / 86_400_000);
}

describe('шлюзы старых адресов не живут вечно (У-263)', () => {
  it('реестры непусты (иначе проверка ничего не значит)', () => {
    expect(allGateways().length).toBeGreaterThan(10);
  });

  it('у каждого шлюза есть дата появления в правильном виде', () => {
    const bad = allGateways()
      .filter((g) => !DATE_SHAPE.test(g.introducedAt))
      .map((g) => `${g.where}: ${g.from} → «${g.introducedAt}»`);
    expect(
      bad,
      'У шлюза нет даты появления или она записана не как ГГГГ-ММ-ДД.\n' +
        'Без даты возраст не посчитать, и шлюз останется навсегда.'
    ).toEqual([]);
  });

  it('два шлюза не занимают один адрес', () => {
    const froms = allGateways().map((g) => g.from);
    const dup = froms.filter((f, i) => froms.indexOf(f) !== i);
    expect(dup, 'один и тот же старый адрес объявлен дважды — уведёт непонятно куда').toEqual([]);
  });

  it('на выдуманное «сегодня» страж считает возраст верно', () => {
    // Проверяем сам счётчик на заведомых данных: иначе легко написать страж,
    // который всегда зелёный, и не заметить этого.
    expect(ageInDays('2026-01-01', new Date('2026-01-01T00:00:00Z'))).toBe(0);
    expect(ageInDays('2026-01-01', new Date('2026-04-01T00:00:00Z'))).toBe(90);
    expect(ageInDays('2026-01-01', new Date('2026-04-02T00:00:00Z'))).toBe(91);
  });

  it('ни один шлюз не старше 90 дней', () => {
    const today = new Date();
    const old = allGateways()
      .map((g) => ({ ...g, age: ageInDays(g.introducedAt, today) }))
      .filter((g) => g.age > MAX_AGE_DAYS)
      .map((g) => `  ${g.where}: ${g.from} — ${g.age} дн. (появился ${g.introducedAt})`);

    expect(
      old,
      'Этим шлюзам больше 90 дней:\n' +
        old.join('\n') +
        '\n\nПора удалить. Перед удалением убедитесь, что старого пути нет в ссылках\n' +
        'писем и уведомлений: ссылка в уже отправленном письме живёт дольше закладки.\n' +
        'Если шлюз должен остаться — обновите дату и запишите причину рядом.'
    ).toEqual([]);
  });
});
