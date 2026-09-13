import { describe, expect, it } from 'vitest';

import {
  BITRIX_ENTITIES,
  BITRIX_ENTITY_TITLES,
  CONFLICT_LABELS,
  SKIP_LABELS,
  countPlan,
  dealStageKey,
  emptyCounts,
  planReason,
  stageKey,
} from '@/lib/services/bitrix/mapping/types';
import type {
  BitrixEntity,
  ConflictReason,
  EntityCounts,
  Plan,
  SkipReason,
} from '@/lib/services/bitrix/mapping/types';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-191`, спека §3.3): общий словарь планов миграции.
 * Всё здесь — чистые функции и справочники, поэтому проверяются таблицами
 * случаев без единого мока.
 *
 * Списки причин ниже перечислены руками и помечены `satisfies`: если из union
 * пропадёт значение — не соберётся типами, если добавится — упадёт сравнение
 * ключей словаря. Так словарь подписей не может отстать от типа.
 */

const SKIP_REASONS = [
  'no_organization',
  'no_contact',
  'empty',
  'too_large',
  'source_no_files',
  'unsupported',
  'already_linked',
  'no_changes',
] as const satisfies readonly SkipReason[];

const CONFLICT_REASONS = [
  'inn_other_company',
  'channel_taken',
  'stage_not_mapped',
  'no_manager',
  'no_deal_stage',
] as const satisfies readonly ConflictReason[];

describe('SKIP_LABELS — русская подпись каждой причины пропуска', () => {
  it('подписи есть у ВСЕХ причин union-типа и лишних ключей нет', () => {
    expect([...Object.keys(SKIP_LABELS)].sort()).toEqual([...SKIP_REASONS].sort());
  });

  it.each(SKIP_REASONS)('причина «%s» имеет непустую подпись', (reason) => {
    expect(SKIP_LABELS[reason].trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['no_organization', 'нет организации'],
    ['no_contact', 'нет контакта'],
    ['empty', 'пустая запись'],
    ['too_large', 'файл больше допустимого размера'],
    ['source_no_files', 'источник не даёт файлов'],
    ['unsupported', 'не поддерживается'],
    ['already_linked', 'уже связано'],
    ['no_changes', 'нечего менять'],
  ] as const)('«%s» → «%s»', (reason, label) => {
    expect(SKIP_LABELS[reason]).toBe(label);
  });
});

describe('CONFLICT_LABELS — русская подпись каждой причины конфликта', () => {
  it('подписи есть у ВСЕХ причин union-типа и лишних ключей нет', () => {
    expect([...Object.keys(CONFLICT_LABELS)].sort()).toEqual([...CONFLICT_REASONS].sort());
  });

  it.each(CONFLICT_REASONS)('причина «%s» имеет непустую подпись', (reason) => {
    expect(CONFLICT_LABELS[reason].trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['inn_other_company', 'ИНН у организации другой компании'],
    ['channel_taken', 'канал уже у другого контакта'],
    ['stage_not_mapped', 'стадия не сопоставлена'],
    ['no_manager', 'некому назначить ответственного'],
    ['no_deal_stage', 'у компании нет подходящей стадии сделки'],
  ] as const)('«%s» → «%s»', (reason, label) => {
    expect(CONFLICT_LABELS[reason]).toBe(label);
  });
});

describe('BITRIX_ENTITIES и BITRIX_ENTITY_TITLES', () => {
  it('сущности перечислены в порядке зависимостей — он же порядок записи', () => {
    // Организация раньше контакта, контакт раньше сделки, заказ последним:
    // это не алфавит, а очередь, в которой ссылки уже существуют.
    expect(BITRIX_ENTITIES).toEqual([
      'organization',
      'contact',
      'lead',
      'deal',
      'note',
      'task',
      'file',
      'order',
    ]);
  });

  it('у КАЖДОЙ сущности есть название и лишних названий нет', () => {
    expect([...Object.keys(BITRIX_ENTITY_TITLES)].sort()).toEqual([...BITRIX_ENTITIES].sort());
  });

  it.each(BITRIX_ENTITIES)('сущность «%s» названа непустой строкой', (entity) => {
    expect(BITRIX_ENTITY_TITLES[entity].trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['organization', 'Организации'],
    ['contact', 'Контакты'],
    ['lead', 'Лиды'],
    ['deal', 'Сделки'],
    ['note', 'Заметки'],
    ['task', 'Задачи'],
    ['file', 'Файлы'],
    ['order', 'Заказы из выигранных сделок'],
  ] as const satisfies readonly (readonly [BitrixEntity, string])[])(
    '«%s» → «%s»',
    (entity, title) => {
      expect(BITRIX_ENTITY_TITLES[entity]).toBe(title);
    }
  );
});

describe('emptyCounts — сводка с нулями', () => {
  it('все четыре колонки нулевые', () => {
    expect(emptyCounts()).toEqual({ create: 0, update: 0, skip: 0, conflict: 0 });
  });

  it('каждый вызов даёт СВОЙ объект, а не общий на всех', () => {
    // Иначе счётчик одной сущности молча приплюсовался бы к соседней.
    const first = emptyCounts();
    const second = emptyCounts();
    first.create += 1;
    expect(second.create).toBe(0);
    expect(first).not.toBe(second);
  });
});

describe('countPlan — каждое действие в свою колонку', () => {
  const PLANS = [
    ['create', { action: 'create', data: {} }, { create: 1, update: 0, skip: 0, conflict: 0 }],
    [
      'update',
      { action: 'update', id: 'o-1', data: {}, before: {} },
      { create: 0, update: 1, skip: 0, conflict: 0 },
    ],
    [
      'skip',
      { action: 'skip', reason: 'no_changes' },
      { create: 0, update: 0, skip: 1, conflict: 0 },
    ],
    [
      'conflict',
      { action: 'conflict', reason: 'channel_taken' },
      { create: 0, update: 0, skip: 0, conflict: 1 },
    ],
  ] as const satisfies readonly (readonly [string, Plan<unknown>, EntityCounts])[];

  it.each(PLANS)('«%s» увеличивает только свою колонку', (_name, plan, expected) => {
    const counts = emptyCounts();
    countPlan(counts, plan);
    expect(counts).toEqual(expected);
  });

  it('считает накопительно по всей порции записей', () => {
    const counts = emptyCounts();
    for (const [, plan] of PLANS) countPlan(counts, plan);
    countPlan(counts, { action: 'create', data: {} });
    expect(counts).toEqual({ create: 2, update: 1, skip: 1, conflict: 1 });
  });
});

describe('planReason — человеческая причина плана', () => {
  it.each([
    ['пропуск — подпись причины', { action: 'skip', reason: 'no_organization' }, 'нет организации'],
    [
      'пропуск другой причины',
      { action: 'skip', reason: 'too_large' },
      'файл больше допустимого размера',
    ],
    [
      'конфликт без подсказки — только подпись',
      { action: 'conflict', reason: 'stage_not_mapped' },
      'стадия не сопоставлена',
    ],
    [
      'конфликт с подсказкой — подпись, двоеточие, подсказка',
      { action: 'conflict', reason: 'inn_other_company', hint: '«Ромашка» уже заведена' },
      'ИНН у организации другой компании: «Ромашка» уже заведена',
    ],
    ['создание — причины нет', { action: 'create', data: {} }, ''],
    ['обновление — причины нет', { action: 'update', id: 'x', data: {}, before: {} }, ''],
  ] as const satisfies readonly (readonly [string, Plan<unknown>, string])[])(
    '%s',
    (_name, plan, expected) => {
      expect(planReason(plan)).toBe(expected);
    }
  );

  it('пустая подсказка не добавляет висящее двоеточие', () => {
    expect(planReason({ action: 'conflict', reason: 'no_manager', hint: '' })).toBe(
      'некому назначить ответственного'
    );
  });
});

describe('stageKey — ключ «направление:стадия» для стадии портала', () => {
  it.each([
    ['направление указано', { categoryId: '7', id: 'C7:WON' }, '7:C7:WON'],
    ['общее направление (null)', { categoryId: null, id: 'NEW' }, '0:NEW'],
    ['направление «0» уже строкой', { categoryId: '0', id: 'NEW' }, '0:NEW'],
  ] as const)('%s → «%s»', (_name, stage, expected) => {
    expect(stageKey(stage)).toBe(expected);
  });

  it('пустая строка направления считается общим направлением — как и у сделки', () => {
    // Ключи стадии и сделки обязаны совпадать: разойдись они, стадия выглядела
    // бы несопоставленной и держала пакет без всякой причины.
    expect(stageKey({ categoryId: '', id: 'NEW' })).toBe('0:NEW');
  });
});

describe('dealStageKey — тот же ключ со стороны сделки', () => {
  it.each([
    ['направление указано', { categoryId: '3', stageId: 'C3:NEW' }, '3:C3:NEW'],
    ['направление пустой строкой', { categoryId: '', stageId: 'NEW' }, '0:NEW'],
  ] as const)('%s → «%s»', (_name, deal, expected) => {
    expect(dealStageKey(deal)).toBe(expected);
  });

  it('ключи сделки и её стадии портала совпадают — иначе таблица не нашлась бы', () => {
    expect(dealStageKey({ categoryId: '', stageId: 'NEW' })).toBe(
      stageKey({ categoryId: null, id: 'NEW' })
    );
    expect(dealStageKey({ categoryId: '7', stageId: 'C7:WON' })).toBe(
      stageKey({ categoryId: '7', id: 'C7:WON' })
    );
  });
});
