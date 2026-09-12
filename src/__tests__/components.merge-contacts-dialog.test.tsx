// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({
  listMergeCandidatesAction: vi.fn(),
  mergeContactsAction: vi.fn(),
}));
vi.mock('@/server-actions/contacts', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import {
  MergeContactsButton,
  MergeContactsDialog,
} from '@/components/manager/contacts/merge-contacts-dialog';
import type { MergeCandidate } from '@/lib/services/contacts/merge';

/**
 * Объединение дублей (этап 1 ТЗ 12.09.2026, `У-181`; спека
 * 2026-09-12-stage1-contacts-and-notes-design §3.5): кандидаты ищутся по мере
 * ввода с задержкой 250 мс (fake timers), владелец занятого канала предложен
 * сразу и не дублируется, без выбора объединять нельзя, успех ведёт в карточку
 * главного, отказ переводится словарём.
 */
const PETR: MergeCandidate = {
  id: 'c2',
  name: 'Пётр Петров',
  position: null,
  organization: { id: 'o1', name: 'Ромашка' },
  channels: [
    { type: 'phone', value: '+7 921 000-00-00' },
    { type: 'email', value: 'petrov@romashka.ru' },
  ],
};
const SIDOR: MergeCandidate = {
  id: 'c3',
  name: 'Сидор Сидоров',
  position: null,
  organization: null,
  channels: [],
};

beforeAll(() => {
  // Нативный <dialog> в jsdom не умеет showModal — как в остальных тестах примитива Dialog.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  actions.listMergeCandidatesAction.mockResolvedValue({ ok: true, items: [PETR, SIDOR] });
});

afterEach(() => vi.useRealTimers());

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function openDialog(): HTMLElement {
  return document.querySelector('dialog[open]') as HTMLElement;
}

function radios(): string[] {
  return Array.from(openDialog().querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
    (r) => `${r.value}${r.checked ? '*' : ''}`
  );
}

function submitButton(): HTMLButtonElement {
  return within(openDialog()).getByRole('button', { name: 'Объединить' }) as HTMLButtonElement;
}

function renderDialog(props: Partial<React.ComponentProps<typeof MergeContactsDialog>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <MergeContactsDialog
      cabinet="manager"
      primaryId="c1"
      primaryName="Иванов Иван"
      open
      onClose={onClose}
      {...props}
    />
  );
  return { ...utils, onClose };
}

describe('MergeContactsDialog — поиск кандидатов', () => {
  it('закрытый диалог кандидатов не ищет', async () => {
    renderDialog({ open: false });
    await settle(1000);
    expect(actions.listMergeCandidatesAction).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });

  it('открытый: запрос без q ровно через 250 мс; строки с организацией и каналами; ввод → запрос с q', async () => {
    renderDialog();
    const dialog = within(openDialog());
    expect(dialog.getByRole('heading', { name: 'Объединить контакты' })).toBeTruthy();
    expect(dialog.getByText('Иванов Иван')).toBeTruthy();
    expect(dialog.getByText('Похожих контактов не найдено — уточните имя.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    await settle(249);
    expect(actions.listMergeCandidatesAction).not.toHaveBeenCalled();
    await settle(1);
    expect(actions.listMergeCandidatesAction).toHaveBeenCalledTimes(1);
    expect(actions.listMergeCandidatesAction.mock.calls[0][0]).toStrictEqual({ excludeId: 'c1' });

    expect(radios()).toEqual(['c2', 'c3']);
    const list = dialog.getByRole('list', { name: 'Кандидаты' });
    expect(list.textContent).toContain('Пётр Петров — Ромашка');
    expect(list.textContent).toContain('+7 921 000-00-00 · petrov@romashka.ru');
    expect(list.textContent).toContain('Сидор Сидоров');
    expect(list.textContent).not.toContain('Сидор Сидоров —');
    expect(dialog.queryByText('Похожих контактов не найдено — уточните имя.')).toBeNull();

    // Ввод с пробелами → q обрезан; отказ сервиса список не трогает.
    actions.listMergeCandidatesAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    fireEvent.change(dialog.getByLabelText('Поиск контакта для объединения'), {
      target: { value: '  пе ' },
    });
    await settle(250);
    expect(actions.listMergeCandidatesAction).toHaveBeenCalledTimes(2);
    expect(actions.listMergeCandidatesAction.mock.calls[1][0]).toStrictEqual({
      excludeId: 'c1',
      q: 'пе',
    });
    expect(radios()).toEqual(['c2', 'c3']);

    // Пустая выдача — подсказка уточнить имя.
    actions.listMergeCandidatesAction.mockResolvedValue({ ok: true, items: [] });
    fireEvent.change(dialog.getByLabelText('Поиск контакта для объединения'), {
      target: { value: 'zzz' },
    });
    await settle(250);
    expect(radios()).toEqual([]);
    expect(dialog.getByText('Похожих контактов не найдено — уточните имя.')).toBeTruthy();
  });

  it('предвыбор показан отдельной строкой и выбран, пока его нет среди кандидатов', async () => {
    renderDialog({ preselect: { contactId: 'c9', name: 'Ольга Орлова' } });
    const dialog = within(openDialog());
    expect(radios()).toEqual(['c9*']);
    expect(dialog.getByText('Ольга Орлова')).toBeTruthy();
    expect(dialog.queryByText('Похожих контактов не найдено — уточните имя.')).toBeNull();
    // Выбран предвыбор — объединять можно сразу.
    expect(submitButton().disabled).toBe(false);
    await settle(250);
    expect(radios()).toEqual(['c9*', 'c2', 'c3']);

    // Можно выбрать кандидата из выдачи и вернуться к предвыбору.
    fireEvent.click(openDialog().querySelector<HTMLInputElement>('input[value="c2"]')!);
    expect(radios()).toEqual(['c9', 'c2*', 'c3']);
    fireEvent.click(openDialog().querySelector<HTMLInputElement>('input[value="c9"]')!);
    expect(radios()).toEqual(['c9*', 'c2', 'c3']);
    expect(submitButton().disabled).toBe(false);

    // Пустая выдача при предвыборе — подсказки «не найдено» нет: строка есть.
    actions.listMergeCandidatesAction.mockResolvedValue({ ok: true, items: [] });
    fireEvent.change(dialog.getByLabelText('Поиск контакта для объединения'), {
      target: { value: 'zzz' },
    });
    await settle(250);
    expect(radios()).toEqual(['c9*']);
    expect(dialog.queryByText('Похожих контактов не найдено — уточните имя.')).toBeNull();
  });

  it('предвыбор среди кандидатов не дублируется', async () => {
    renderDialog({ preselect: { contactId: 'c2', name: 'Пётр Петров' } });
    expect(radios()).toEqual(['c2*']);
    await settle(250);
    expect(radios()).toEqual(['c2*', 'c3']);
    expect(within(openDialog()).getAllByText('Пётр Петров')).toHaveLength(1);
  });

  it('выбранный кандидат исчез из выдачи → кнопка снова заблокирована', async () => {
    renderDialog({ preselect: { contactId: 'c9', name: 'Ольга Орлова' } });
    await settle(250);
    const petr = openDialog().querySelector<HTMLInputElement>('input[value="c2"]')!;
    fireEvent.click(petr);
    expect(radios()).toEqual(['c9', 'c2*', 'c3']);
    expect(submitButton().disabled).toBe(false);

    actions.listMergeCandidatesAction.mockResolvedValue({ ok: true, items: [] });
    fireEvent.change(within(openDialog()).getByLabelText('Поиск контакта для объединения'), {
      target: { value: 'zzz' },
    });
    await settle(250);
    expect(radios()).toEqual(['c9']);
    expect(submitButton().disabled).toBe(true);
  });
});

describe('MergeContactsDialog — отправка', () => {
  it('отправка формы без выбора → ошибка, action не зовётся', async () => {
    renderDialog();
    await settle(250);
    // Кнопка заблокирована, но форму можно отправить иначе — защита должна держать.
    fireEvent.submit(openDialog().querySelector('form')!);
    await settle(0);
    expect(within(openDialog()).getByRole('alert').textContent).toBe(
      'Выберите, какой контакт объединить с этим.'
    );
    expect(actions.mergeContactsAction).not.toHaveBeenCalled();
  });

  it('успех → action с главным и вторым, тост, onClose, переход в карточку главного и refresh', async () => {
    actions.mergeContactsAction.mockResolvedValue({ ok: true, primaryId: 'c1', moved: {} });
    const { onClose } = renderDialog();
    await settle(250);
    fireEvent.click(openDialog().querySelector<HTMLInputElement>('input[value="c3"]')!);
    expect(radios()).toEqual(['c2', 'c3*']);
    fireEvent.click(submitButton());
    await settle(0);
    expect(actions.mergeContactsAction).toHaveBeenCalledWith({
      primaryId: 'c1',
      secondaryId: 'c3',
    });
    expect(toastMock.success).toHaveBeenCalledWith('Контакты объединены');
    expect(onClose).toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith('/manager/contacts/c1');
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('отказ → текст из общего словаря, диалог остаётся открытым', async () => {
    actions.mergeContactsAction.mockResolvedValue({
      ok: false,
      error: 'contact_merge_two_users',
    });
    const { onClose } = renderDialog({ cabinet: 'leader' });
    await settle(250);
    fireEvent.click(openDialog().querySelector<HTMLInputElement>('input[value="c2"]')!);
    fireEvent.click(submitButton());
    await settle(0);
    expect(within(openDialog()).getByRole('alert').textContent).toBe(
      'У обоих контактов есть пользователи кабинета — это два разных человека, объединять их нельзя.'
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('код из словаря формы переводится им', async () => {
    actions.mergeContactsAction.mockResolvedValue({ ok: false, error: 'not_found' });
    renderDialog();
    await settle(250);
    fireEvent.click(openDialog().querySelector<HTMLInputElement>('input[value="c2"]')!);
    fireEvent.click(submitButton());
    await settle(0);
    expect(within(openDialog()).getByRole('alert').textContent).toBe(
      'Контакт не найден — обновите страницу.'
    );
  });
});

describe('MergeContactsButton', () => {
  it('кнопка меню открывает диалог с именем главного; «Отмена» закрывает', async () => {
    render(<MergeContactsButton cabinet="admin" primaryId="c1" primaryName="Иванов Иван" />);
    expect(openDialog()).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Объединить' })[0]);
    const dialog = within(openDialog());
    expect(dialog.getByRole('heading', { name: 'Объединить контакты' })).toBeTruthy();
    expect(dialog.getByText('Иванов Иван')).toBeTruthy();
    await settle(250);
    expect(actions.listMergeCandidatesAction.mock.calls[0][0]).toStrictEqual({ excludeId: 'c1' });
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }));
    await settle(0);
    expect(openDialog()).toBeNull();
  });
});
