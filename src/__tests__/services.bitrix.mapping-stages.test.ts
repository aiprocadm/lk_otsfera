import { describe, expect, it } from 'vitest';

import {
  BITRIX_TASK_STATUSES,
  BITRIX_TASK_STATUS_LABELS,
  persistStageId,
  proposeLeadStageMap,
  proposeStageMap,
  proposeTaskColumnMap,
  stageMapComplete,
  unmappedStages,
} from '@/lib/services/bitrix/mapping/stages';
import type { TargetStage } from '@/lib/services/bitrix/mapping/stages';
import type { BitrixStage, BitrixTaskStatus } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-193`): стадии и статусы портала → стадии ЛК.
 *
 * Предложение строится само, но всё несопоставленное остаётся `null` — пакет
 * нельзя применить, пока человек не выберет стадию, иначе сделки молча
 * свалились бы в одну кучу.
 */

const dealStage = (over: Partial<BitrixStage> = {}): BitrixStage => ({
  entity: 'deal',
  categoryId: null,
  id: 'NEW',
  name: 'Новая',
  semantics: 'process',
  ...over,
});

const leadStage = (over: Partial<BitrixStage> = {}): BitrixStage => ({
  entity: 'lead',
  categoryId: null,
  id: 'NEW',
  name: 'Новый',
  semantics: 'process',
  ...over,
});

const target = (
  id: string,
  name: string,
  statusAnchor: string,
  isTerminal = false
): TargetStage => ({
  id,
  name,
  statusAnchor,
  isTerminal,
});

/** Стадии сделок ЛК — так их отдаёт доска компании. */
const DEAL_STAGES: TargetStage[] = [
  target('ds-intake', 'Приём заявки', 'intake'),
  target('ds-work', 'В работе', 'in_progress'),
  target('ds-won', 'Выиграна', 'won', true),
  target('ds-lost', 'Проиграна', 'lost', true),
];

const FUNNEL_STAGES: TargetStage[] = [
  target('fs-new', 'Новый', 'new'),
  target('fs-work', 'В работе', 'in_progress'),
  target('fs-deal', 'Стал сделкой', 'promoted_to_deal', true),
  target('fs-rejected', 'Отклонён', 'rejected', true),
];

const TASK_COLUMNS: TargetStage[] = [
  target('col-todo', 'К выполнению', 'todo'),
  target('col-work', 'В работе', 'in_progress'),
  target('col-review', 'На проверке', 'review'),
  target('col-done', 'Готово', 'done', true),
];

describe('persistStageId — что можно записать в строку сущности', () => {
  it.each([
    ['настоящий идентификатор стадии', 'ds-won', 'ds-won'],
    ['идентификатор с двоеточием внутри', 'ds:won', 'ds:won'],
    ['синтетическая стадия по умолчанию', 'default:won', null],
    ['другая синтетическая стадия', 'default:new', null],
    ['пустая строка', '', null],
    ['ничего не выбрано', null, null],
  ] as const)('%s: «%s» → %s', (_name, id, expected) => {
    expect(persistStageId(id)).toBe(expected);
  });

  it('слово default в середине идентификатора не считается синтетикой', () => {
    expect(persistStageId('stage-default:won')).toBe('stage-default:won');
  });
});

describe('proposeStageMap — стадии сделок портала', () => {
  it('семантика «выиграна» ведёт на стадию с якорем won, даже если названия разные', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'WON', name: 'Сделка успешна', semantics: 'success' })],
      DEAL_STAGES
    );
    expect(map).toEqual({ '0:WON': 'ds-won' });
  });

  it('семантика «проиграна» ведёт на стадию с якорем lost', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'LOSE', name: 'Сделка провалена', semantics: 'failure' })],
      DEAL_STAGES
    );
    expect(map).toEqual({ '0:LOSE': 'ds-lost' });
  });

  it('семантика «извинились» (apology) — тоже провал: предлагается проигранная стадия', () => {
    // «Извинились перед клиентом» в Битриксе — финальная стадия неуспеха,
    // поэтому предлагается проигранная стадия даже при чужом названии: иначе
    // живая стадия портала осталась бы несопоставленной и держала пакет.
    const byName = proposeStageMap(
      [dealStage({ id: 'APOLOGY', name: 'Проиграна', semantics: 'apology' })],
      DEAL_STAGES
    );
    expect(byName).toEqual({ '0:APOLOGY': 'ds-lost' });

    const otherName = proposeStageMap(
      [dealStage({ id: 'APOLOGY', name: 'Извинились перед клиентом', semantics: 'apology' })],
      DEAL_STAGES
    );
    expect(otherName).toEqual({ '0:APOLOGY': 'ds-lost' });
  });

  it.each([
    ['точное совпадение', 'В работе'],
    ['другой регистр', 'в РАБОТЕ'],
    ['двойные пробелы', 'В  работе'],
    ['пробелы по краям', '  В работе  '],
    ['перенос строки внутри', 'В\nработе'],
  ] as const)('совпадение по названию: %s («%s»)', (_name, name) => {
    const map = proposeStageMap([dealStage({ id: 'WORK', name })], DEAL_STAGES);
    expect(map).toEqual({ '0:WORK': 'ds-work' });
  });

  it('«ё» приравнивается к «е» с обеих сторон', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'IN', name: 'ПРИЕМ  заявки' })],
      [target('ds-e', 'Приём заявки', 'intake')]
    );
    expect(map).toEqual({ '0:IN': 'ds-e' });
  });

  it('ни якоря, ни названия — стадия остаётся несопоставленной', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'X', name: 'Согласование юристом' })],
      DEAL_STAGES
    );
    expect(map).toEqual({ '0:X': null });
  });

  it('пустое название не ищется по названию — сразу null', () => {
    const map = proposeStageMap([dealStage({ id: 'X', name: '   ' })], DEAL_STAGES);
    expect(map).toEqual({ '0:X': null });
  });

  it('якоря нет среди стадий ЛК — работает запасное совпадение по названию', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'WON', name: 'Успех', semantics: 'success' })],
      [target('ds-final', 'Успех', 'final', true)]
    );
    expect(map).toEqual({ '0:WON': 'ds-final' });
  });

  it('нет ни якоря, ни названия среди стадий ЛК — null', () => {
    const map = proposeStageMap(
      [dealStage({ id: 'WON', name: 'Успех', semantics: 'success' })],
      [target('ds-final', 'Финал', 'final', true)]
    );
    expect(map).toEqual({ '0:WON': null });
  });

  it('ключ строится из направления и стадии: у общего направления — «0»', () => {
    const map = proposeStageMap(
      [
        dealStage({ categoryId: null, id: 'NEW' }),
        dealStage({ categoryId: '7', id: 'C7:NEW' }),
        dealStage({ categoryId: '0', id: 'ZERO' }),
      ],
      DEAL_STAGES
    );
    expect(Object.keys(map)).toEqual(['0:NEW', '7:C7:NEW', '0:ZERO']);
  });

  it('стадии лидов в таблицу сделок не попадают', () => {
    const map = proposeStageMap(
      [leadStage({ id: 'LEAD_NEW', semantics: 'success' }), dealStage({ id: 'NEW' })],
      DEAL_STAGES
    );
    expect(Object.keys(map)).toEqual(['0:NEW']);
  });

  it('пустой портал — пустая таблица', () => {
    expect(proposeStageMap([], DEAL_STAGES)).toEqual({});
  });

  describe('сохранённый выбор человека', () => {
    it('сильнее догадки', () => {
      const map = proposeStageMap([dealStage({ id: 'WON', semantics: 'success' })], DEAL_STAGES, {
        '0:WON': 'ds-work',
      });
      expect(map).toEqual({ '0:WON': 'ds-work' });
    });

    it('но только если стадия ещё существует — иначе считаем заново', () => {
      const map = proposeStageMap([dealStage({ id: 'WON', semantics: 'success' })], DEAL_STAGES, {
        '0:WON': 'ds-deleted',
      });
      expect(map).toEqual({ '0:WON': 'ds-won' });
    });

    it('сохранённое «не сопоставлено» (null) не мешает предложить догадку', () => {
      const map = proposeStageMap([dealStage({ id: 'WON', semantics: 'success' })], DEAL_STAGES, {
        '0:WON': null,
      });
      expect(map).toEqual({ '0:WON': 'ds-won' });
    });

    it('запись про чужой ключ ни на что не влияет', () => {
      const map = proposeStageMap([dealStage({ id: 'NEW' })], DEAL_STAGES, { '9:OTHER': 'ds-won' });
      expect(map).toEqual({ '0:NEW': null });
    });
  });
});

describe('proposeLeadStageMap — статусы лидов портала', () => {
  it('семантика «успех» ведёт в «стал сделкой»', () => {
    const map = proposeLeadStageMap(
      [leadStage({ id: 'CONVERTED', name: 'Сконвертирован', semantics: 'success' })],
      FUNNEL_STAGES
    );
    expect(map).toEqual({ CONVERTED: 'fs-deal' });
  });

  it('семантика «провал» ведёт в «отклонён»', () => {
    const map = proposeLeadStageMap(
      [leadStage({ id: 'JUNK', name: 'Некачественный лид', semantics: 'failure' })],
      FUNNEL_STAGES
    );
    expect(map).toEqual({ JUNK: 'fs-rejected' });
  });

  it('остальные статусы — по названию, с нормализацией регистра и пробелов', () => {
    const map = proposeLeadStageMap(
      [leadStage({ id: 'WORK', name: ' в  РАБОТЕ ' })],
      FUNNEL_STAGES
    );
    expect(map).toEqual({ WORK: 'fs-work' });
  });

  it('семантика «извинились» тоже идёт по названию', () => {
    const map = proposeLeadStageMap(
      [leadStage({ id: 'APOLOGY', name: 'Отклонён', semantics: 'apology' })],
      FUNNEL_STAGES
    );
    expect(map).toEqual({ APOLOGY: 'fs-rejected' });
  });

  it('якоря нет в воронке ЛК — запасное совпадение по названию', () => {
    const map = proposeLeadStageMap(
      [leadStage({ id: 'CONVERTED', name: 'Готов', semantics: 'success' })],
      [target('fs-ready', 'Готов', 'ready')]
    );
    expect(map).toEqual({ CONVERTED: 'fs-ready' });
  });

  it('ничего не подошло — null', () => {
    const map = proposeLeadStageMap([leadStage({ id: 'X', name: 'Думает' })], FUNNEL_STAGES);
    expect(map).toEqual({ X: null });
  });

  it('пустое название — null без поиска', () => {
    const map = proposeLeadStageMap([leadStage({ id: 'X', name: '' })], FUNNEL_STAGES);
    expect(map).toEqual({ X: null });
  });

  it('ключ — идентификатор статуса, направление не участвует', () => {
    const map = proposeLeadStageMap([leadStage({ categoryId: '7', id: 'NEW' })], FUNNEL_STAGES);
    expect(Object.keys(map)).toEqual(['NEW']);
  });

  it('стадии сделок в таблицу лидов не попадают', () => {
    const map = proposeLeadStageMap(
      [dealStage({ id: 'DEAL_NEW', semantics: 'success' }), leadStage({ id: 'NEW' })],
      FUNNEL_STAGES
    );
    expect(Object.keys(map)).toEqual(['NEW']);
  });

  describe('сохранённый выбор человека', () => {
    it('сильнее догадки', () => {
      const map = proposeLeadStageMap(
        [leadStage({ id: 'CONVERTED', semantics: 'success' })],
        FUNNEL_STAGES,
        { CONVERTED: 'fs-work' }
      );
      expect(map).toEqual({ CONVERTED: 'fs-work' });
    });

    it('исчезнувшая стадия воронки — считаем заново', () => {
      const map = proposeLeadStageMap(
        [leadStage({ id: 'CONVERTED', semantics: 'success' })],
        FUNNEL_STAGES,
        { CONVERTED: 'fs-deleted' }
      );
      expect(map).toEqual({ CONVERTED: 'fs-deal' });
    });

    it('сохранённый null не мешает догадке', () => {
      const map = proposeLeadStageMap([leadStage({ id: 'NEW' })], FUNNEL_STAGES, { NEW: null });
      expect(map).toEqual({ NEW: 'fs-new' });
    });
  });
});

describe('BITRIX_TASK_STATUSES и подписи статусов', () => {
  it('пять статусов задач портала в порядке 2..6', () => {
    expect(BITRIX_TASK_STATUSES).toEqual([2, 3, 4, 5, 6]);
  });

  it('у каждого статуса есть русская подпись и лишних подписей нет', () => {
    expect([...Object.keys(BITRIX_TASK_STATUS_LABELS)].sort()).toEqual(['2', '3', '4', '5', '6']);
    for (const status of BITRIX_TASK_STATUSES) {
      expect(BITRIX_TASK_STATUS_LABELS[status].trim().length).toBeGreaterThan(0);
    }
  });

  it.each([
    [2, 'Ждёт выполнения'],
    [3, 'Выполняется'],
    [4, 'Ждёт контроля'],
    [5, 'Завершена'],
    [6, 'Отложена'],
  ] as const satisfies readonly (readonly [BitrixTaskStatus, string])[])(
    'статус %i → «%s»',
    (status, label) => {
      expect(BITRIX_TASK_STATUS_LABELS[status]).toBe(label);
    }
  );
});

describe('proposeTaskColumnMap — статусы задач портала → колонки ЛК', () => {
  it.each([
    [2, 'col-todo'],
    [3, 'col-work'],
    [4, 'col-review'],
    [5, 'col-done'],
    [6, 'col-todo'],
  ] as const)('статус %i ложится в колонку «%s»', (status, columnId) => {
    expect(proposeTaskColumnMap(TASK_COLUMNS)[String(status)]).toBe(columnId);
  });

  it('отложенная задача (6) едет туда же, куда ждущая (2) — в «К выполнению»', () => {
    const map = proposeTaskColumnMap(TASK_COLUMNS);
    expect(map['6']).toBe(map['2']);
  });

  it('таблица покрывает ровно пять статусов, ключи — строки', () => {
    expect(Object.keys(proposeTaskColumnMap(TASK_COLUMNS))).toEqual(['2', '3', '4', '5', '6']);
  });

  it('колонок у компании нет — все статусы остаются несопоставленными', () => {
    expect(proposeTaskColumnMap([])).toEqual({
      '2': null,
      '3': null,
      '4': null,
      '5': null,
      '6': null,
    });
  });

  it('нужного якоря нет — берётся ПЕРВАЯ колонка доски', () => {
    // Задача обязана куда-то лечь: доска без «на проверке» всё равно принимает задачи.
    const columns = [
      target('col-any', 'Все задачи', 'backlog'),
      target('col-2', 'Вторая', 'other'),
    ];
    expect(proposeTaskColumnMap(columns)).toEqual({
      '2': 'col-any',
      '3': 'col-any',
      '4': 'col-any',
      '5': 'col-any',
      '6': 'col-any',
    });
  });

  it('частичное совпадение якорей: что нашлось — по якорю, остальное — в первую', () => {
    const columns = [
      target('col-any', 'Все задачи', 'backlog'),
      target('col-done', 'Готово', 'done', true),
    ];
    expect(proposeTaskColumnMap(columns)).toEqual({
      '2': 'col-any',
      '3': 'col-any',
      '4': 'col-any',
      '5': 'col-done',
      '6': 'col-any',
    });
  });

  describe('сохранённый выбор человека', () => {
    it('сильнее умолчания', () => {
      expect(proposeTaskColumnMap(TASK_COLUMNS, { '2': 'col-done' })['2']).toBe('col-done');
    });

    it('исчезнувшая колонка — считаем заново', () => {
      expect(proposeTaskColumnMap(TASK_COLUMNS, { '2': 'col-deleted' })['2']).toBe('col-todo');
    });

    it('сохранённый null не мешает умолчанию', () => {
      expect(proposeTaskColumnMap(TASK_COLUMNS, { '3': null })['3']).toBe('col-work');
    });
  });
});

describe('unmappedStages — что человек ещё не выбрал', () => {
  it('несопоставленная стадия сделки подписана «Сделки: …»', () => {
    expect(unmappedStages([dealStage({ id: 'NEW', name: 'Новая' })], {}, {})).toEqual([
      'Сделки: Новая',
    ]);
  });

  it('несопоставленный статус лида подписан «Лиды: …»', () => {
    expect(unmappedStages([leadStage({ id: 'NEW', name: 'Новый' })], {}, {})).toEqual([
      'Лиды: Новый',
    ]);
  });

  it('сопоставленные стадии в список не попадают', () => {
    const portal = [
      dealStage({ id: 'NEW', name: 'Новая' }),
      dealStage({ categoryId: '7', id: 'C7:WON', name: 'Выиграна' }),
      leadStage({ id: 'LEAD_NEW', name: 'Новый' }),
    ];
    expect(
      unmappedStages(portal, { '0:NEW': 'ds-intake', '7:C7:WON': 'ds-won' }, { LEAD_NEW: 'fs-new' })
    ).toEqual([]);
  });

  it.each([
    ['ключа в таблице нет', {}],
    ['значение null', { '0:NEW': null }],
    ['значение пустой строкой', { '0:NEW': '' }],
  ] as const)('%s — считается несопоставленным', (_name, stageMap) => {
    expect(unmappedStages([dealStage({ id: 'NEW', name: 'Новая' })], stageMap, {})).toEqual([
      'Сделки: Новая',
    ]);
  });

  it('порядок списка — как в портале, сделки и лиды вперемешку', () => {
    const portal = [
      dealStage({ id: 'D1', name: 'Первая' }),
      leadStage({ id: 'L1', name: 'Лидовая' }),
      dealStage({ id: 'D2', name: 'Вторая' }),
    ];
    expect(unmappedStages(portal, { '0:D2': 'ds-won' }, {})).toEqual([
      'Сделки: Первая',
      'Лиды: Лидовая',
    ]);
  });

  it('таблица сделок не закрывает статус лида с тем же идентификатором', () => {
    // Ключи разные по построению: у сделки — «направление:стадия», у лида — сам id.
    expect(
      unmappedStages([leadStage({ id: 'NEW', name: 'Новый' })], { '0:NEW': 'ds-intake' }, {})
    ).toEqual(['Лиды: Новый']);
  });
});

describe('stageMapComplete — можно ли применять пакет', () => {
  const portal = [dealStage({ id: 'NEW', name: 'Новая' }), leadStage({ id: 'L', name: 'Новый' })];

  it('все стадии выбраны — можно', () => {
    expect(stageMapComplete(portal, { '0:NEW': 'ds-intake' }, { L: 'fs-new' })).toBe(true);
  });

  it('хоть одна стадия не выбрана — нельзя', () => {
    expect(stageMapComplete(portal, { '0:NEW': 'ds-intake' }, {})).toBe(false);
    expect(stageMapComplete(portal, {}, { L: 'fs-new' })).toBe(false);
  });

  it('портал без стадий — пустая проверка проходит', () => {
    expect(stageMapComplete([], {}, {})).toBe(true);
  });
});
