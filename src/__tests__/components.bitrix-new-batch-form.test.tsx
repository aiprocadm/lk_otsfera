// @vitest-environment jsdom
/**
 * Форма «Новый пакет» (этап 2 PR-3, `У-193`): главная кнопка считает
 * ПРЕДПРОСМОТР, а не переносит. Проверяем объяснение, выбор источника и его
 * подсказки, блокировку кнопки у неготового источника, скрытое поле с ключами
 * выгрузок, переход в карточку пакета после успеха и русский текст ошибки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { createBitrixBatchAction } = vi.hoisted(() => ({ createBitrixBatchAction: vi.fn() }));
vi.mock('@/server-actions/admin/bitrix', () => ({ createBitrixBatchAction }));

import {
  NewBatchForm,
  type ManagerOption,
  type UploadedFileKey,
} from '@/components/bitrix/new-batch-form';

const FILE_KEYS: UploadedFileKey[] = [
  { key: 'bitrix-import/uploads/c1/1-companies.csv', name: 'companies.csv', entity: 'company' },
];
const MANAGERS: ManagerOption[] = [
  { id: 'm1', name: 'Анна' },
  { id: 'm2', name: 'Борис' },
];

function renderForm(over: Partial<React.ComponentProps<typeof NewBatchForm>> = {}) {
  const utils = render(
    React.createElement(NewBatchForm, {
      managers: MANAGERS,
      fileKeys: [],
      hasConnection: true,
      ...over,
    })
  );
  const { container } = utils;
  return {
    container,
    form: () => container.querySelector('form') as HTMLFormElement,
    source: () => container.querySelector('#bitrix-batch-source') as HTMLSelectElement,
    manager: () => container.querySelector('#bitrix-batch-manager') as HTMLSelectElement,
    button: () => container.querySelector('button[type="submit"]') as HTMLButtonElement,
    hidden: () => container.querySelector('input[name="fileKeys"]') as HTMLInputElement,
    alert: () => container.querySelector('[role="alert"]') as HTMLElement,
    text: () => container.textContent ?? '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createBitrixBatchAction.mockResolvedValue({ ok: true, batchId: 'b-77' });
});

describe('NewBatchForm', () => {
  it('заголовок и обещание «данные не меняются»; период, флажки и менеджеры на месте', () => {
    const ui = renderForm();

    expect(ui.container.querySelector('h2')?.textContent).toBe('Новый пакет');
    expect(ui.text()).toContain('Данные при этом не меняются.');
    expect(ui.button().textContent).toBe('Посчитать предпросмотр');

    // Менеджер по умолчанию: «не выбран» + переданные сотрудники.
    expect([...ui.manager().options].map((o) => `${o.value}:${o.textContent}`)).toEqual([
      ':— не выбран —',
      'm1:Анна',
      'm2:Борис',
    ]);
    expect(ui.text()).toContain('чей ответственный не нашёлся среди сотрудников');
    expect(ui.text()).toContain('Пустые даты — переносим всю историю.');
    expect(ui.container.querySelector('input[name="from"]')?.getAttribute('type')).toBe('date');
    expect(ui.container.querySelector('input[name="to"]')?.getAttribute('type')).toBe('date');
    // «Переносить файлы» отмечено по умолчанию, «только открытые» — нет.
    expect(
      (ui.container.querySelector('input[name="withFiles"]') as HTMLInputElement).checked
    ).toBe(true);
    expect((ui.container.querySelector('input[name="openOnly"]') as HTMLInputElement).checked).toBe(
      false
    );
  });

  it('скрытое поле несёт ключи выгрузок одной JSON-строкой', () => {
    const ui = renderForm({ fileKeys: FILE_KEYS });
    expect(JSON.parse(ui.hidden().value)).toEqual(FILE_KEYS);

    // Выгрузок нет — поле всё равно есть, но с пустым списком.
    expect(renderForm().hidden().value).toBe('[]');
  });

  it('портал подключён — источник «по вебхуку», кнопка доступна, подсказок нет', () => {
    const ui = renderForm({ hasConnection: true });
    expect(ui.source().value).toBe('rest');
    expect(ui.button().disabled).toBe(false);
    expect(ui.text()).not.toContain('Портал не подключён');
    expect(ui.text()).not.toContain('Сначала загрузите выгрузки');
  });

  it('портала нет — источник сразу «из выгрузок»; без файлов кнопка закрыта и объясняет почему', () => {
    const ui = renderForm({ hasConnection: false, fileKeys: [] });
    expect(ui.source().value).toBe('file');
    expect(ui.button().disabled).toBe(true);
    expect(ui.text()).toContain('Сначала загрузите выгрузки формой выше');

    // Переключаемся на портал — подсказка меняется на «портал не подключён».
    fireEvent.change(ui.source(), { target: { value: 'rest' } });
    expect(ui.source().value).toBe('rest');
    expect(ui.button().disabled).toBe(true);
    expect(ui.text()).toContain('Портал не подключён');
    expect(ui.text()).toContain('вкладке «Подключение»');
    expect(ui.text()).not.toContain('Сначала загрузите выгрузки');
  });

  it('портала нет, но выгрузки загружены — кнопка доступна; переключение на портал её закрывает', () => {
    const ui = renderForm({ hasConnection: false, fileKeys: FILE_KEYS });
    expect(ui.source().value).toBe('file');
    expect(ui.button().disabled).toBe(false);
    expect(ui.text()).not.toContain('Сначала загрузите выгрузки');

    fireEvent.change(ui.source(), { target: { value: 'rest' } });
    expect(ui.button().disabled).toBe(true);
  });

  it('портал подключён, выгрузок нет — переключение на файлы закрывает кнопку, обратно открывает', () => {
    const ui = renderForm({ hasConnection: true, fileKeys: [] });
    fireEvent.change(ui.source(), { target: { value: 'file' } });
    expect(ui.source().value).toBe('file');
    expect(ui.button().disabled).toBe(true);

    fireEvent.change(ui.source(), { target: { value: 'rest' } });
    expect(ui.source().value).toBe('rest');
    expect(ui.button().disabled).toBe(false);
  });

  it('успех: действие получает поля формы, а человек — карточку нового пакета', async () => {
    const ui = renderForm({ hasConnection: false, fileKeys: FILE_KEYS });
    fireEvent.click(ui.container.querySelector('input[name="openOnly"]') as HTMLInputElement);
    fireEvent.change(ui.manager(), { target: { value: 'm2' } });
    fireEvent.change(ui.container.querySelector('input[name="from"]') as HTMLInputElement, {
      target: { value: '2026-01-01' },
    });
    fireEvent.submit(ui.form());

    await waitFor(() => expect(createBitrixBatchAction).toHaveBeenCalledTimes(1));
    const fd = createBitrixBatchAction.mock.calls[0]![0] as FormData;
    expect(fd.get('source')).toBe('file');
    expect(fd.get('defaultManagerId')).toBe('m2');
    expect(fd.get('from')).toBe('2026-01-01');
    expect(fd.get('to')).toBe('');
    expect(fd.get('openOnly')).toBe('on');
    expect(fd.get('withFiles')).toBe('on');
    expect(JSON.parse(String(fd.get('fileKeys')))).toEqual(FILE_KEYS);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/admin/settings/integrations/bitrix/history/b-77')
    );
    expect(ui.alert().textContent).toBe('');
    expect(ui.alert().className).toContain('sr-only');
  });

  it('успех без идентификатора пакета никуда не уводит (страница обновится сама)', async () => {
    createBitrixBatchAction.mockResolvedValue({ ok: true });
    const ui = renderForm();
    fireEvent.submit(ui.form());
    await waitFor(() => expect(createBitrixBatchAction).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('пока считается — кнопка «Считаем…» и закрыта, даже у готового источника', async () => {
    let release!: (v: { ok: true; batchId: string }) => void;
    createBitrixBatchAction.mockImplementation(
      () =>
        new Promise<{ ok: true; batchId: string }>((resolve) => {
          release = resolve;
        })
    );
    const ui = renderForm();

    await act(async () => {
      fireEvent.submit(ui.form());
    });
    expect(ui.button().textContent).toBe('Считаем…');
    expect(ui.button().disabled).toBe(true);

    await act(async () => {
      release({ ok: true, batchId: 'b-9' });
    });
    await waitFor(() => expect(ui.button().textContent).toBe('Посчитать предпросмотр'));
    expect(ui.button().disabled).toBe(false);
  });

  it.each([
    ['forbidden', 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.'],
    [
      'invalid',
      'Проверьте настройки пакета: выберите источник, а для переноса из файлов — загрузите выгрузки.',
    ],
    ['not_found', 'Пакет не найден.'],
    ['mapping_incomplete', 'Сначала сопоставьте все стадии сделок и статусы лидов.'],
  ])('ошибка %s показывается по-русски в живой области', async (code, message) => {
    createBitrixBatchAction.mockResolvedValue({ ok: false, error: code });
    const ui = renderForm();
    fireEvent.submit(ui.form());

    await waitFor(() => expect(ui.alert().textContent).toBe(message));
    expect(ui.alert().className).not.toContain('sr-only');
    expect(ui.alert().textContent).not.toContain(code);
    expect(push).not.toHaveBeenCalled();
  });

  it('незнакомый код не показывается сырым — общий словарь подставляет свою строку', async () => {
    createBitrixBatchAction.mockResolvedValue({ ok: false, error: 'validation' });
    const ui = renderForm();
    fireEvent.submit(ui.form());
    await waitFor(() => expect(ui.alert().textContent).toBe('Проверьте поля формы.'));
  });
});
