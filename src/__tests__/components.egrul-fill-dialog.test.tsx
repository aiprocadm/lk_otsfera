// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * `У-94`: «Найти в ЕГРЮЛ». Главное здесь — **галочки**: подсказка не должна
 * затирать то, что человек уже внёс руками. Проверяем, что снятое поле до
 * сервера не доходит, и что отказы объясняются по-русски.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { fillOrgFromEgrulAction } = vi.hoisted(() => ({ fillOrgFromEgrulAction: vi.fn() }));
vi.mock('@/server-actions/organization/egrul', () => ({ fillOrgFromEgrulAction }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { EgrulFillDialog } from '@/components/organization/egrul-fill-dialog';

const SUGGESTION = {
  name: 'ООО «Ромашка»',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700132195',
  address: 'Москва, ул. Полевая, 1',
  status: 'ACTIVE',
  opf: 'ООО',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Нативный <dialog> в jsdom не открывается сам.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  fillOrgFromEgrulAction.mockResolvedValue({ ok: true, filled: ['inn'] });
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ suggestions: [SUGGESTION] }),
  }) as never;
});

function open() {
  render(<EgrulFillDialog organizationId="org-1" organizationName="Ромашка" />);
  fireEvent.click(screen.getByRole('button', { name: 'Найти в ЕГРЮЛ' }));
  return within(document.querySelector('dialog[open]') as HTMLElement);
}

async function pickFirst(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));
  await waitFor(() => dialog.getByText('ООО «Ромашка»'));
  fireEvent.click(dialog.getByRole('radio'));
  await waitFor(() => dialog.getByText('Что заполнить'));
}

describe('EgrulFillDialog (У-94)', () => {
  it('по умолчанию отмечены все поля, которые подсказка знает', async () => {
    const dialog = open();
    await pickFirst(dialog);

    fireEvent.click(dialog.getByRole('button', { name: 'Заполнить' }));
    await waitFor(() => expect(fillOrgFromEgrulAction).toHaveBeenCalled());
    expect(fillOrgFromEgrulAction.mock.calls[0]![0].values).toEqual({
      inn: '7707083893',
      kpp: '770701001',
      legalName: 'ООО «Ромашка»',
      ogrn: '1027700132195',
      legalAddress: 'Москва, ул. Полевая, 1',
    });
  });

  it('снятая галочка до сервера не доходит — внесённое вручную не затрётся', async () => {
    const dialog = open();
    await pickFirst(dialog);

    const checkboxes = dialog.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0] as HTMLElement); // ИНН
    fireEvent.click(dialog.getByRole('button', { name: 'Заполнить' }));

    await waitFor(() => expect(fillOrgFromEgrulAction).toHaveBeenCalled());
    expect(fillOrgFromEgrulAction.mock.calls[0]![0].values.inn).toBeUndefined();
    expect(fillOrgFromEgrulAction.mock.calls[0]![0].values.kpp).toBe('770701001');
  });

  it('поле, которого нет в ЕГРЮЛ, отмечать нечем', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ suggestions: [{ ...SUGGESTION, ogrn: null, address: null }] }),
    }) as never;
    const dialog = open();
    await pickFirst(dialog);

    expect(dialog.getAllByText('нет в ЕГРЮЛ', { exact: false })).toHaveLength(2);
    const disabled = dialog
      .getAllByRole('checkbox')
      .filter((c) => (c as HTMLInputElement).disabled);
    expect(disabled).toHaveLength(2);
  });

  it('ничего не нашлось — экран объясняет, что делать дальше (У-74)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ suggestions: [] }) }) as never;
    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));
    await waitFor(() => dialog.getByText('Ничего не нашлось', { exact: false }));
  });

  it('занятый ИНН объясняется по-русски, а не кодом', async () => {
    fillOrgFromEgrulAction.mockResolvedValue({ ok: false, error: 'inn_taken' });
    const dialog = open();
    await pickFirst(dialog);
    fireEvent.click(dialog.getByRole('button', { name: 'Заполнить' }));

    await waitFor(() => dialog.getByText('уже занят другой организацией', { exact: false }));
  });

  it('подсказки не отдались — можно внести вручную, экран не падает', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as never;
    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));
    await waitFor(() => dialog.getByText('внести вручную', { exact: false }));
  });

  it('слишком короткий запрос не уходит на сервер', async () => {
    render(<EgrulFillDialog organizationId="org-1" organizationName="Р" />);
    fireEvent.click(screen.getByRole('button', { name: 'Найти в ЕГРЮЛ' }));
    const dialog = within(document.querySelector('dialog[open]') as HTMLElement);
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));

    await waitFor(() => dialog.getByText('хотя бы два символа', { exact: false }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('успех закрывает окно и сообщает, сколько полей заполнено', async () => {
    const dialog = open();
    await pickFirst(dialog);
    fireEvent.click(dialog.getByRole('button', { name: 'Заполнить' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заполнено полей: 1.'));
  });
});

/**
 * Что ещё умеет окно (`У-94`).
 *
 * Главное здесь — **ликвидированный тёзка**. У популярных названий десятки
 * однофамильцев, и часть из них давно закрыта. Подставить реквизиты закрытой
 * фирмы значит выставить счёт в никуда, поэтому состояние по ЕГРЮЛ печатается
 * прямо в строке выбора, а не прячется за кнопкой «подробнее».
 */
describe('EgrulFillDialog — выбор из нескольких', () => {
  it('ликвидированная организация подписана «не действует»', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        suggestions: [
          { ...SUGGESTION, name: 'ООО «Ромашка» (старая)', status: 'LIQUIDATED' },
          SUGGESTION,
        ],
      }),
    }) as never;

    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));

    await waitFor(() => dialog.getByText(/не действует/));
    // Действующая такой подписи не несёт — иначе пометка ничего не значила бы.
    expect(dialog.getAllByText(/не действует/)).toHaveLength(1);
  });

  it('адреса нет — строка не превращается в «ИНН 770… · undefined»', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ suggestions: [{ ...SUGGESTION, address: null, status: null }] }),
    }) as never;

    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));

    await waitFor(() => dialog.getByText('ООО «Ромашка»'));
    expect(dialog.queryByText(/undefined|null/)).toBeNull();
  });

  it('ответ без списка подсказок — пустой экран с объяснением, а не падение', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({}) }) as never;

    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));

    await waitFor(() =>
      expect(dialog.getByText('Ничего не нашлось', { exact: false })).toBeTruthy()
    );
  });

  it('«Заполнить» без выбора ничего не отправляет', async () => {
    const dialog = open();
    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));
    await waitFor(() => dialog.getByText('ООО «Ромашка»'));

    // Кнопка выключена, пока никто не выбран: нажатие вслепую заполнило бы
    // карточку реквизитами первой попавшейся организации.
    expect((dialog.getByRole('button', { name: 'Заполнить' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(fillOrgFromEgrulAction).not.toHaveBeenCalled();
  });

  it('новый поиск сбрасывает прежний выбор', async () => {
    const dialog = open();
    await pickFirst(dialog);

    fireEvent.click(dialog.getByRole('button', { name: 'Найти' }));

    // Иначе человек выбрал бы одну организацию, поискал другую и заполнил
    // карточку реквизитами первой, не заметив этого.
    await waitFor(() =>
      expect(
        (dialog.getByRole('button', { name: 'Заполнить' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
  });

  it('«Отмена» закрывает окно, ничего не отправив', async () => {
    const dialog = open();
    await pickFirst(dialog);

    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));

    expect(fillOrgFromEgrulAction).not.toHaveBeenCalled();
  });
});
