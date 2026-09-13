// @vitest-environment jsdom
/**
 * Таблицы сопоставления предпросмотра (этап 2 PR-3, `У-193`): стадии сделок,
 * статусы лидов, статусы задач и сотрудники — в ОДНОЙ форме с одной кнопкой.
 * Проверяем состав таблиц, доступные имена селектов, значения по умолчанию,
 * имена полей (их разбирает `saveBatchMappingAction`), сохранение, обе живые
 * области и запрет правки у применённого пакета.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { saveBatchMappingAction } = vi.hoisted(() => ({ saveBatchMappingAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => ({ saveBatchMappingAction }));

import { MappingTables, type MappingTablesProps } from '@/components/bitrix/mapping-tables';
import type { BitrixStage } from '@/lib/services/bitrix/source';
import type { UserMapRow } from '@/lib/services/bitrix/mapping/types';

const STAGES: BitrixStage[] = [
  // Общее направление: `categoryId: null` превращается в «0» в ключе таблицы.
  { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
  { entity: 'deal', categoryId: '7', id: 'C7:WON', name: 'Успех', semantics: 'success' },
  { entity: 'lead', categoryId: null, id: 'JUNK', name: 'Мусор', semantics: 'failure' },
];

const USERS: UserMapRow[] = [
  { bitrixId: '1', name: 'Анна', email: 'anna@portal.ru', userId: 'm1', matchedBy: 'email' },
  { bitrixId: '2', name: 'Борис', email: null, userId: null, matchedBy: 'none' },
  { bitrixId: '3', name: 'Вера', email: 'vera@portal.ru', userId: null, matchedBy: 'table' },
];

function props(over: Partial<MappingTablesProps> = {}): MappingTablesProps {
  return {
    batchId: 'b-1',
    stages: STAGES,
    users: USERS,
    dealStages: [
      { id: 'ds1', name: 'В работе' },
      { id: 'ds2', name: 'Выиграна' },
    ],
    funnelStages: [{ id: 'fs1', name: 'Отклонён' }],
    taskColumns: [
      { id: 'tc1', name: 'К выполнению' },
      { id: 'tc2', name: 'Готово' },
    ],
    companyUsers: [
      { id: 'm1', name: 'Анна Админова' },
      { id: 'm2', name: 'Борис Петров' },
    ],
    values: {
      stageMap: { '0:NEW': 'ds1' },
      leadStageMap: {},
      taskColumnMap: { '5': 'tc2' },
      // Решение человека сильнее найденного совпадения: у «Веры» в таблице m2.
      userMap: { '3': 'm2' },
    },
    ...over,
  };
}

function renderTables(over: Partial<MappingTablesProps> = {}) {
  const utils = render(React.createElement(MappingTables, props(over)));
  const { container } = utils;
  return {
    container,
    form: () => container.querySelector('form') as HTMLFormElement,
    button: () => container.querySelector('button[type="submit"]') as HTMLButtonElement,
    alert: () => container.querySelector('[role="alert"]') as HTMLElement,
    status: () => container.querySelector('[role="status"]') as HTMLElement,
    titles: () => [...container.querySelectorAll('h3')].map((h) => h.textContent),
    select: (name: string) =>
      container.querySelector(`select[name="${name}"]`) as HTMLSelectElement,
    selects: () => [...container.querySelectorAll('select')] as HTMLSelectElement[],
    text: () => container.textContent ?? '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveBatchMappingAction.mockResolvedValue({ ok: true });
});

describe('MappingTables', () => {
  it('четыре таблицы с пояснениями; у каждого селекта — доступное имя строки', () => {
    const ui = renderTables();

    expect(ui.titles()).toEqual(['Стадии сделок', 'Статусы лидов', 'Статусы задач', 'Сотрудники']);
    expect(ui.text()).toContain('Слева — стадии вашего портала');
    expect(ui.text()).toContain('Куда попадут лиды из Битрикса');
    expect(ui.text()).toContain('В какую колонку доски задач');
    expect(ui.text()).toContain('Пусто — менеджеру по умолчанию.');

    // Читалке слышно, о какой строке речь: «таблица: строка».
    expect(ui.selects().map((s) => s.getAttribute('aria-label'))).toEqual([
      'Стадии сделок: Новая',
      'Стадии сделок: Успех',
      'Статусы лидов: Мусор',
      'Статусы задач: Ждёт выполнения',
      'Статусы задач: Выполняется',
      'Статусы задач: Ждёт контроля',
      'Статусы задач: Завершена',
      'Статусы задач: Отложена',
      'Сотрудники: Анна (anna@portal.ru)',
      'Сотрудники: Борис', // почты нет — показываем только имя
      'Сотрудники: Вера (vera@portal.ru)',
    ]);

    // Идентификатор пакета едет скрытым полем — действие ищет его по имени.
    expect((ui.container.querySelector('input[name="batchId"]') as HTMLInputElement).value).toBe(
      'b-1'
    );
  });

  it('имена полей: ключ стадии сделки — «направление:стадия», у общего направления «0»', () => {
    const ui = renderTables();
    const names = ui.selects().map((s) => s.getAttribute('name'));
    expect(names).toEqual([
      'stage:0:NEW',
      'stage:7:C7:WON',
      'leadStage:JUNK',
      'taskColumn:2',
      'taskColumn:3',
      'taskColumn:4',
      'taskColumn:5',
      'taskColumn:6',
      'user:1',
      'user:2',
      'user:3',
    ]);
  });

  it('значения по умолчанию: сохранённая таблица, затем найденный сотрудник, иначе пусто', () => {
    const ui = renderTables();

    expect(ui.select('stage:0:NEW').value).toBe('ds1'); // из stageMap
    expect(ui.select('stage:7:C7:WON').value).toBe(''); // в stageMap нет — «— выберите —»
    expect(ui.select('leadStage:JUNK').value).toBe('');
    expect(ui.select('taskColumn:5').value).toBe('tc2');
    expect(ui.select('taskColumn:2').value).toBe('');

    expect(ui.select('user:1').value).toBe('m1'); // нашёлся по почте
    expect(ui.select('user:2').value).toBe(''); // не нашёлся — менеджер по умолчанию
    expect(ui.select('user:3').value).toBe('m2'); // выбор человека сильнее

    // Пустой вариант у сотрудников назван по-своему: пусто ≠ «не выбрано».
    expect(ui.select('user:1').options[0]?.textContent).toBe('— менеджер по умолчанию —');
    expect(ui.select('stage:0:NEW').options[0]?.textContent).toBe('— выберите —');
    expect([...ui.select('stage:0:NEW').options].map((o) => o.value)).toEqual(['', 'ds1', 'ds2']);
    expect([...ui.select('leadStage:JUNK').options].map((o) => o.value)).toEqual(['', 'fs1']);
    expect([...ui.select('taskColumn:2').options].map((o) => o.value)).toEqual(['', 'tc1', 'tc2']);
    expect([...ui.select('user:1').options].map((o) => o.value)).toEqual(['', 'm1', 'm2']);
  });

  it('найденный сотрудник, которого нет среди вариантов, показывается как «менеджер по умолчанию»', () => {
    // Замечание к боевому коду: `userId` приходит из поиска по почте и может
    // указывать на пользователя ЛК вне списка активных менеджеров. Тогда
    // браузер молча выбирает первый вариант, и человек видит «— менеджер по
    // умолчанию —» вместо найденного сотрудника.
    const ui = renderTables({
      users: [
        {
          bitrixId: '9',
          name: 'Гость',
          email: 'ghost@portal.ru',
          userId: 'u-9',
          matchedBy: 'email',
        },
      ],
    });
    expect(ui.select('user:9').value).toBe('');
  });

  it('таблица без строк не рисуется вовсе — у портала может не быть лидов или сотрудников', () => {
    const ui = renderTables({
      stages: STAGES.filter((s) => s.entity === 'deal'),
      users: [],
    });
    expect(ui.titles()).toEqual(['Стадии сделок', 'Статусы задач']);
    expect(ui.text()).not.toContain('Куда попадут лиды из Битрикса');
    expect(ui.text()).not.toContain('Пусто — менеджеру по умолчанию.');
  });

  it('у портала нет ни одной стадии — остаются только статусы задач', () => {
    const ui = renderTables({ stages: [], users: [] });
    expect(ui.titles()).toEqual(['Статусы задач']);
    expect(ui.container.querySelectorAll('table')).toHaveLength(1);
  });

  it('сохранение: действие получает пакет и все выбранные значения; успех — подтверждением', async () => {
    const ui = renderTables();
    fireEvent.change(ui.select('stage:7:C7:WON'), { target: { value: 'ds2' } });
    fireEvent.change(ui.select('leadStage:JUNK'), { target: { value: 'fs1' } });
    fireEvent.change(ui.select('user:2'), { target: { value: 'm1' } });
    fireEvent.submit(ui.form());

    await waitFor(() => expect(saveBatchMappingAction).toHaveBeenCalledTimes(1));
    const fd = saveBatchMappingAction.mock.calls[0]![0] as FormData;
    expect(fd.get('batchId')).toBe('b-1');
    expect(fd.get('stage:0:NEW')).toBe('ds1');
    expect(fd.get('stage:7:C7:WON')).toBe('ds2');
    expect(fd.get('leadStage:JUNK')).toBe('fs1');
    expect(fd.get('taskColumn:5')).toBe('tc2');
    expect(fd.get('taskColumn:2')).toBe('');
    expect(fd.get('user:1')).toBe('m1');
    expect(fd.get('user:2')).toBe('m1');

    await waitFor(() => expect(ui.status().textContent).toBe('Сопоставление сохранено.'));
    expect(ui.status().className).not.toContain('sr-only');
    // Страница перечитывается: от сопоставления зависит блок «Применение».
    expect(refresh).toHaveBeenCalled();
    expect(ui.alert().textContent).toBe('');
    expect(ui.alert().className).toContain('sr-only');
  });

  it('пока сохраняем — кнопка «Сохраняем…» и закрыта, подтверждения ещё нет', async () => {
    let release!: (v: { ok: true }) => void;
    saveBatchMappingAction.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          release = resolve;
        })
    );
    const ui = renderTables();

    await act(async () => {
      fireEvent.submit(ui.form());
    });
    expect(ui.button().textContent).toBe('Сохраняем…');
    expect(ui.button().disabled).toBe(true);
    expect(ui.status().className).toContain('sr-only');

    await act(async () => {
      release({ ok: true });
    });
    await waitFor(() => expect(ui.button().textContent).toBe('Сохранить сопоставление'));
    expect(ui.button().disabled).toBe(false);
  });

  it.each([
    ['forbidden', 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.'],
    ['not_found', 'Пакет не найден — возможно, его удалили.'],
    ['invalid', 'Сопоставление можно менять, пока пакет не применён.'],
  ])('ошибка %s — по-русски в области тревоги, без подтверждения', async (code, message) => {
    saveBatchMappingAction.mockResolvedValue({ ok: false, error: code });
    const ui = renderTables();
    fireEvent.submit(ui.form());

    await waitFor(() => expect(ui.alert().textContent).toBe(message));
    expect(ui.alert().className).not.toContain('sr-only');
    expect(ui.status().textContent).toBe('');
    expect(ui.status().className).toContain('sr-only');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('пакет уже применён (disabled): все селекты и кнопка закрыты', () => {
    const ui = renderTables({ disabled: true });
    expect(ui.selects()).toHaveLength(11);
    expect(ui.selects().every((s) => s.disabled)).toBe(true);
    expect(ui.button().disabled).toBe(true);
  });

  it('без явного disabled правка открыта', () => {
    const ui = renderTables();
    expect(ui.selects().some((s) => s.disabled)).toBe(false);
    expect(ui.button().disabled).toBe(false);
  });

  it('подписи таблиц продублированы для читалки, а первая колонка — названия портала', () => {
    const ui = renderTables();
    const captions = [...ui.container.querySelectorAll('caption')].map((c) => c.textContent);
    expect(captions).toEqual(['Стадии сделок', 'Статусы лидов', 'Статусы задач', 'Сотрудники']);

    const firstTable = ui.container.querySelectorAll('table')[0]!;
    const heads = [...firstTable.querySelectorAll('th')].map((th) => th.textContent);
    expect(heads).toEqual(['В Битрикс24', 'В личном кабинете']);
    expect(
      [...within(firstTable as HTMLElement).getAllByRole('row')]
        .slice(1)
        .map((tr) => tr.querySelector('td')?.textContent)
    ).toEqual(['Новая', 'Успех']);
  });
});
