import { describe, expect, it } from 'vitest';

import type { TargetStage } from '@/lib/services/bitrix/mapping/stages';
import {
  DEFERRED_NOTE,
  planTask,
  type ExistingTask,
  type TaskLookup,
} from '@/lib/services/bitrix/mapping/tasks';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixTask } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-191`): задача портала → `Task`.
 *
 * Запись взята из фикстуры портала: задача 501 «Отправить КП Альфа Строй»
 * (статус 5 — завершена, привязана к компании 101 и сделке 401).
 */

/** Колонки канбана ЛК: дефолтные (`default:*`) и кастомная с настоящим id. */
const COLUMNS: readonly TargetStage[] = [
  { id: 'default:todo', name: 'К выполнению', statusAnchor: 'todo', isTerminal: false },
  { id: 'column-in-progress', name: 'В работе', statusAnchor: 'in_progress', isTerminal: false },
  { id: 'default:done', name: 'Готово', statusAnchor: 'done', isTerminal: true },
];

const DEADLINE = new Date('2025-10-10T00:00:00Z');
const CLOSED_AT = new Date('2025-10-09T15:00:00Z');

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: {
      stageMap: {},
      leadStageMap: {},
      taskColumnMap: { '2': 'default:todo', '3': 'column-in-progress', '5': 'default:done' },
      userMap: {},
    },
    resolveUser: (id) => (id === '1' ? 'user-ivan' : id === '2' ? 'user-petr' : null),
    ...over,
  };
}

function taskOf(over: Partial<BitrixTask> = {}): BitrixTask {
  return {
    id: '501',
    title: 'Отправить КП Альфа Строй',
    description: 'По итогам звонка',
    status: 5,
    responsibleId: '1',
    createdById: '2',
    deadline: DEADLINE,
    createdAt: new Date('2025-10-06T09:00:00Z'),
    closedAt: CLOSED_AT,
    crmLinks: [
      { kind: 'company', id: '101' },
      { kind: 'deal', id: '401' },
    ],
    ...over,
  };
}

function lookupOf(over: Partial<TaskLookup> = {}): TaskLookup {
  return {
    byBitrixId: () => undefined,
    organizationByBitrixId: (id) => (id === '101' ? 'org-1' : undefined),
    dealByBitrixId: (id) => (id === '401' ? 'deal-1' : undefined),
    leadByBitrixId: (id) => (id === '303' ? 'lead-1' : undefined),
    contactOrganization: (id) => (id === '208' ? 'org-gamma' : undefined),
    ...over,
  };
}

const EXISTING: ExistingTask = {
  id: 'task-1',
  title: 'Отправить КП Альфа Строй',
  status: 'done',
  columnId: null,
  completedAt: new Date('2025-10-09T15:00:00Z'),
};

describe('planTask — колонка: без сопоставления переносить нельзя', () => {
  it('колонка не сопоставлена → конфликт stage_not_mapped с подсказкой про статус', () => {
    const plan = planTask(taskOf({ status: 4 }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toEqual({
      action: 'conflict',
      reason: 'stage_not_mapped',
      hint: 'статус задачи 4',
    });
  });

  it('колонка сопоставлена в null → тот же конфликт', () => {
    const ctx = ctxOf();
    const plan = planTask(
      taskOf({ status: 2 }),
      ctxOf({ tables: { ...ctx.tables, taskColumnMap: { '2': null } } }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'stage_not_mapped' });
  });

  it('выбранной колонки в канбане больше нет → конфликт', () => {
    const ctx = ctxOf();
    const plan = planTask(
      taskOf({ status: 2 }),
      ctxOf({ tables: { ...ctx.tables, taskColumnMap: { '2': 'column-deleted' } } }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'conflict', reason: 'stage_not_mapped' });
  });
});

describe('planTask — создание новой задачи', () => {
  it('завершённая задача: статус из якоря колонки, дата завершения перенесена', () => {
    const plan = planTask(taskOf(), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: 'company-1',
        title: 'Отправить КП Альфа Строй',
        description: 'По итогам звонка',
        status: 'done',
        // `default:done` — синтетическая колонка, в строку её писать нельзя.
        columnId: null,
        createdById: 'user-petr',
        assigneeIds: ['user-ivan'],
        dueDate: DEADLINE,
        completedAt: CLOSED_AT,
        linkedOrganizationId: 'org-1',
        linkedDealId: 'deal-1',
        linkedLeadId: null,
        bitrixId: '501',
      },
    });
  });

  it('настоящий id колонки сохраняется как есть', () => {
    const plan = planTask(
      taskOf({ id: '502', status: 3, closedAt: null }),
      ctxOf(),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { status: 'in_progress', columnId: 'column-in-progress' },
    });
  });

  it('дата завершения переносится только у статуса 5', () => {
    const plan = planTask(taskOf({ status: 3 }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { completedAt: null } });
  });

  it('пустое название заменяется на «Задача Битрикс24 #id»', () => {
    const plan = planTask(taskOf({ id: '888', title: '  ' }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { title: 'Задача Битрикс24 #888' } });
  });

  it('срока нет → null', () => {
    const plan = planTask(taskOf({ deadline: null }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { dueDate: null } });
  });
});

describe('planTask — постановщик и исполнитель', () => {
  it('постановщик сопоставлен — берём его', () => {
    const plan = planTask(taskOf(), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { createdById: 'user-petr' } });
  });

  it('постановщик не сопоставлен → менеджер по умолчанию', () => {
    const plan = planTask(taskOf({ createdById: '3' }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { createdById: 'user-default' } });
  });

  it('ни постановщика, ни умолчания → автором становится запустивший пакет', () => {
    const plan = planTask(
      taskOf({ createdById: null }),
      ctxOf({ defaultManagerId: null }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'create', data: { createdById: 'user-importer' } });
  });

  it('исполнитель не сопоставлен → менеджер по умолчанию', () => {
    const plan = planTask(taskOf({ responsibleId: '3' }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { assigneeIds: ['user-default'] } });
  });

  it('исполнителя нет и умолчания нет → задача без исполнителей', () => {
    const plan = planTask(
      taskOf({ responsibleId: null }),
      ctxOf({ defaultManagerId: null }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'create', data: { assigneeIds: [] } });
  });
});

describe('planTask — отложенная задача (статус 6)', () => {
  it('пометка дописывается к описанию отдельным абзацем', () => {
    const ctx = ctxOf();
    const plan = planTask(
      taskOf({ id: '504', status: 6, closedAt: null }),
      ctxOf({ tables: { ...ctx.tables, taskColumnMap: { '6': 'default:todo' } } }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { description: `По итогам звонка\n\n${DEFERRED_NOTE}`, status: 'todo' },
    });
  });

  it('описания не было — в описании остаётся одна пометка', () => {
    const ctx = ctxOf();
    const plan = planTask(
      taskOf({ id: '504', status: 6, description: null, closedAt: null }),
      ctxOf({ tables: { ...ctx.tables, taskColumnMap: { '6': 'default:todo' } } }),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'create', data: { description: DEFERRED_NOTE } });
  });

  it('описание из одних пробелов и без пометки → описания нет', () => {
    const plan = planTask(taskOf({ description: '   ' }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { description: null } });
  });

  it('описания нет и задача не отложена → описания нет', () => {
    const plan = planTask(taskOf({ description: null }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({ action: 'create', data: { description: null } });
  });
});

describe('planTask — привязки к CRM', () => {
  it('компания, сделка и лид переносятся по своим идентификаторам', () => {
    const plan = planTask(
      taskOf({
        crmLinks: [
          { kind: 'company', id: '101' },
          { kind: 'deal', id: '401' },
          { kind: 'lead', id: '303' },
        ],
      }),
      ctxOf(),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: {
        linkedOrganizationId: 'org-1',
        linkedDealId: 'deal-1',
        linkedLeadId: 'lead-1',
      },
    });
  });

  it('контакт привязывается через свою организацию', () => {
    const plan = planTask(
      taskOf({ crmLinks: [{ kind: 'contact', id: '208' }] }),
      ctxOf(),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({ action: 'create', data: { linkedOrganizationId: 'org-gamma' } });
  });

  it('первая выигравшая ссылка каждого вида остаётся — вторая не перебивает', () => {
    const plan = planTask(
      taskOf({
        crmLinks: [
          { kind: 'company', id: '101' },
          { kind: 'company', id: '105' },
          { kind: 'contact', id: '208' },
          { kind: 'deal', id: '401' },
          { kind: 'deal', id: '402' },
          { kind: 'lead', id: '303' },
          { kind: 'lead', id: '305' },
        ],
      }),
      ctxOf(),
      lookupOf({ organizationByBitrixId: (id) => (id === '101' ? 'org-1' : 'org-gamma') }),
      COLUMNS
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { linkedOrganizationId: 'org-1', linkedDealId: 'deal-1', linkedLeadId: 'lead-1' },
    });
  });

  it('связанные записи не перенеслись → ссылки пустые, но задача переносится', () => {
    const plan = planTask(
      taskOf({
        crmLinks: [
          { kind: 'company', id: '999' },
          { kind: 'deal', id: '999' },
          { kind: 'lead', id: '999' },
          { kind: 'contact', id: '999' },
        ],
      }),
      ctxOf(),
      lookupOf(),
      COLUMNS
    );

    expect(plan).toMatchObject({
      action: 'create',
      data: { linkedOrganizationId: null, linkedDealId: null, linkedLeadId: null },
    });
  });

  it('привязок нет вовсе → все ссылки пустые', () => {
    const plan = planTask(taskOf({ crmLinks: [] }), ctxOf(), lookupOf(), COLUMNS);

    expect(plan).toMatchObject({
      action: 'create',
      data: { linkedOrganizationId: null, linkedDealId: null, linkedLeadId: null },
    });
  });
});

describe('planTask — повторный перенос той же задачи', () => {
  it('изменилось название → update одного поля со снимком «как было»', () => {
    const plan = planTask(
      taskOf({ title: 'Отправить КП Альфа Строй — повторно' }),
      ctxOf(),
      lookupOf({ byBitrixId: () => EXISTING }),
      COLUMNS
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'task-1',
      data: { title: 'Отправить КП Альфа Строй — повторно' },
      before: { title: 'Отправить КП Альфа Строй' },
    });
  });

  it('изменился статус → вместе с ним переписываются колонка и дата завершения', () => {
    const plan = planTask(
      taskOf({ status: 3, closedAt: null }),
      ctxOf(),
      lookupOf({ byBitrixId: () => ({ ...EXISTING, columnId: 'default:done' }) }),
      COLUMNS
    );

    expect(plan).toEqual({
      action: 'update',
      id: 'task-1',
      data: { status: 'in_progress', columnId: 'column-in-progress', completedAt: null },
      // Дата завершения гасится вместе со статусом, поэтому она в снимке.
      before: {
        status: 'done',
        columnId: 'default:done',
        completedAt: new Date('2025-10-09T15:00:00Z'),
      },
    });
  });

  it('ничего не изменилось → skip no_changes', () => {
    const plan = planTask(taskOf(), ctxOf(), lookupOf({ byBitrixId: () => EXISTING }), COLUMNS);

    expect(plan).toEqual({ action: 'skip', reason: 'no_changes', id: 'task-1' });
  });
});
