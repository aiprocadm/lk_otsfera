import { describe, it, expect } from 'vitest';
import {
  hasChanges,
  mergeUpdate,
  sameValue,
  type FieldMap,
} from '@/lib/services/bitrix/idempotency';

/**
 * Три правила повторного применения пакета (`У-195`, спека §3.4).
 *
 * Перенос запускают несколько раз подряд, поэтому проверяется ровно то, ради
 * чего модуль написан: пустое из Битрикса не затирает заполненное в кабинете,
 * совпадающее не пишется второй раз (даже когда пришло другим типом), а поле,
 * которое человек правил руками между прогонами, остаётся за человеком. Живой
 * базы здесь нет и не нужно: это чистые функции.
 */
describe('sameValue', () => {
  it('две даты с одним временем — одно значение, с разным — разные', () => {
    expect(sameValue(new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T10:00:00Z'))).toBe(
      true
    );
    expect(sameValue(new Date('2026-01-01T10:00:00Z'), new Date('2026-01-02T10:00:00Z'))).toBe(
      false
    );
  });

  it('дата против пустого — разные значения с любой стороны', () => {
    expect(sameValue(new Date('2026-01-01T10:00:00Z'), null)).toBe(false);
    expect(sameValue(null, new Date('2026-01-01T10:00:00Z'))).toBe(false);
    expect(sameValue(new Date('2026-01-01T10:00:00Z'), 'нет')).toBe(false);
  });

  it('null и undefined — одно и то же «пусто»', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, 'Альфа')).toBe(false);
  });

  it('заполненное против пустого — разные значения', () => {
    expect(sameValue('Альфа', null)).toBe(false);
    expect(sameValue('Альфа', undefined)).toBe(false);
  });

  it('сумма числом и та же сумма строкой — одно значение', () => {
    expect(sameValue(120000, '120000')).toBe(true);
    expect(sameValue('120000', 120000)).toBe(true);
    expect(sameValue(120000, 120000)).toBe(true);
    expect(sameValue(120000, '99')).toBe(false);
  });

  it('строки и логические значения сравниваются как есть', () => {
    expect(sameValue('Альфа', 'Альфа')).toBe(true);
    expect(sameValue('Альфа', 'Бета')).toBe(false);
    expect(sameValue(true, true)).toBe(true);
    expect(sameValue(true, false)).toBe(false);
  });
});

describe('mergeUpdate — правило 1: пустое из Битрикса не затирает', () => {
  it('null, undefined, пустая строка и пробелы не попадают в запись', () => {
    const merged = mergeUpdate(
      { name: 'ООО «Альфа»', inn: '7701234560', kpp: '770101001', notes: 'живая заметка' },
      { name: null, inn: undefined, kpp: '', notes: '   ' },
      null
    );

    expect(merged.data).toEqual({});
    expect(merged.before).toEqual({});
    expect(merged.after).toEqual({});
    expect(merged.keptManual).toEqual([]);
    expect(hasChanges(merged)).toBe(false);
  });

  it('ноль и `false` пустыми не считаются — они значения, а не отсутствие', () => {
    const merged = mergeUpdate(
      { amount: 120000, archived: true },
      { amount: 0, archived: false },
      null
    );

    expect(merged.data).toEqual({ amount: 0, archived: false });
  });
});

describe('mergeUpdate — совпадающее не пишется', () => {
  it('одинаковые строки, равные по времени даты и число против строки пропускаются', () => {
    const merged = mergeUpdate(
      {
        name: 'ООО «Альфа»',
        wonAt: new Date('2026-01-01T10:00:00Z'),
        amount: 120000,
      },
      {
        name: 'ООО «Альфа»',
        wonAt: new Date('2026-01-01T10:00:00Z'),
        amount: '120000',
      },
      null
    );

    expect(merged.data).toEqual({});
    expect(hasChanges(merged)).toBe(false);
  });
});

describe('mergeUpdate — правило 2: правленное руками не перезаписывается', () => {
  it('текущее значение разошлось с `after` прошлого прогона — поле остаётся человеку', () => {
    const merged = mergeUpdate(
      { name: 'ООО «Альфа» (уточнено менеджером)', position: 'Директор' },
      { name: 'ООО «Альфа»', position: 'Главный инженер' },
      { name: 'ООО «Альфа из Битрикса»' }
    );

    expect(merged.keptManual).toEqual(['name']);
    // Правленое поле не пишется…
    expect(merged.data).not.toHaveProperty('name');
    // …а соседнее, которого прошлый прогон не трогал, пишется как обычно.
    expect(merged.data).toEqual({ position: 'Главный инженер' });
    expect(merged.before).toEqual({ position: 'Директор' });
  });

  it('первый прогон (`lastAfter` = null) пишет всё изменившееся', () => {
    const merged = mergeUpdate(
      { name: 'ООО «Альфа» (правил человек)' },
      { name: 'ООО «Альфа»' },
      null
    );

    expect(merged.keptManual).toEqual([]);
    expect(merged.data).toEqual({ name: 'ООО «Альфа»' });
  });

  it('поле есть в `lastAfter` и совпадает с текущим — значит, его не трогали: пишем', () => {
    const merged = mergeUpdate(
      { name: 'ООО «Альфа»' },
      { name: 'ООО «Альфа-2»' },
      { name: 'ООО «Альфа»' }
    );

    expect(merged.keptManual).toEqual([]);
    expect(merged.data).toEqual({ name: 'ООО «Альфа-2»' });
    expect(merged.before).toEqual({ name: 'ООО «Альфа»' });
  });

  it('поля нет в `lastAfter` — прошлый прогон его не писал, правило не применяется', () => {
    const merged = mergeUpdate(
      { position: 'Директор' },
      { position: 'Главный инженер' },
      { name: 'ООО «Альфа»' }
    );

    expect(merged.keptManual).toEqual([]);
    expect(merged.data).toEqual({ position: 'Главный инженер' });
  });

  it('дата из журнала приходит строкой ISO — поле не считается правленым руками', () => {
    // Журнал хранит `Json`, поэтому дата возвращается из него строкой ISO.
    // Сравнивать её надо по времени: иначе поле-дата на каждом прогоне
    // выглядело бы правленым человеком и не обновилось бы никогда, а отчёт
    // всякий раз печатал бы ложное «оставлено ручное значение».
    const merged = mergeUpdate(
      { wonAt: new Date('2026-01-01T10:00:00Z'), title: 'Сделка' },
      { wonAt: new Date('2026-02-01T10:00:00Z'), title: 'Сделка из Битрикса' },
      { wonAt: '2026-01-01T10:00:00.000Z', title: 'Сделка' }
    );

    expect(merged.keptManual).toEqual([]);
    expect(merged.data).toMatchObject({ title: 'Сделка из Битрикса' });
    expect(merged.data.wonAt).toEqual(new Date('2026-02-01T10:00:00Z'));
  });

  it('дату, которую человек и правда правил, оставляем ему', () => {
    // Прошлый прогон записал одну дату, а в кабинете стоит другая — значит,
    // её меняли руками, и перенос истории не должен спорить с человеком.
    const merged = mergeUpdate(
      { wonAt: new Date('2026-03-01T10:00:00Z') },
      { wonAt: new Date('2026-02-01T10:00:00Z') },
      { wonAt: '2026-01-01T10:00:00.000Z' }
    );

    expect(merged.keptManual).toEqual(['wonAt']);
    expect(merged.data).toEqual({});
  });

  it('сумма из журнала приходит числом или строкой — и там, и там ручной правкой не считается', () => {
    // Для сумм правило работает: `sameValue` сравнивает их по числу.
    const merged = mergeUpdate(
      { amount: 120000, title: 'Сделка' },
      { amount: '150000', title: 'Сделка из Битрикса' },
      { amount: '120000' }
    );

    expect(merged.keptManual).toEqual([]);
    expect(merged.data).toEqual({ amount: '150000', title: 'Сделка из Битрикса' });
  });
});

describe('mergeUpdate — правило 3: `before` только по изменённым полям', () => {
  it('в `before` ровно те же ключи, что в `data`, со старыми значениями', () => {
    const merged = mergeUpdate(
      { name: 'ООО «Альфа»', kpp: null, inn: '7701234560' },
      { name: 'ООО «Бета»', kpp: '770101001', inn: '7701234560' },
      null
    );

    expect(Object.keys(merged.before).sort()).toEqual(Object.keys(merged.data).sort());
    expect(merged.before).toEqual({ name: 'ООО «Альфа»', kpp: null });
    expect(merged.after).toEqual({ name: 'ООО «Бета»', kpp: '770101001' });
    // Совпавший ИНН в снимок отката не попал — откатывать его нечем и незачем.
    expect(merged.before).not.toHaveProperty('inn');
  });

  it('поля, которого в кабинете не было вовсе, `before` помнит как null', () => {
    const current: FieldMap = {};
    const merged = mergeUpdate(current, { bitrixId: '101' }, null);

    expect(merged.data).toEqual({ bitrixId: '101' });
    expect(merged.before).toEqual({ bitrixId: null });
    expect(merged.after).toEqual({ bitrixId: '101' });
  });
});

describe('hasChanges', () => {
  it('пустой патч — писать нечего', () => {
    expect(hasChanges({ data: {}, before: {}, after: {}, keptManual: ['name'] })).toBe(false);
  });

  it('непустой патч — есть что писать', () => {
    expect(
      hasChanges({
        data: { name: 'ООО «Бета»' },
        before: { name: null },
        after: { name: 'ООО «Бета»' },
        keptManual: [],
      })
    ).toBe(true);
  });
});

describe('sameValue — дата, которой не бывает', () => {
  it('строка похожа на дату, но не разбирается — значением даты не считается', () => {
    // `Json` хранит даты строкой, поэтому разбор обязателен. Но строка из
    // журнала может быть испорчена: тогда сравнение обязано сказать «разные»,
    // а не притвориться, что даты совпали, и пропустить обновление.
    expect(sameValue(new Date('2026-01-01T10:00:00Z'), '2026-13-45T99:99:99Z')).toBe(false);
    expect(sameValue('2026-13-45T99:99:99Z', '2026-13-45T99:99:99Z')).toBe(true);
  });
});
