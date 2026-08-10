// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * Диалог «Новый сотрудник» (`У-24`…`У-26`, этап 5) — до сих пор его не
 * отрисовывал ни один тест: страницы кабинетов подменяли его заглушкой.
 * Здесь он проверяется как есть, включая обратный вызов `onCreated`, который
 * добавил этап 6 (`У-40`): мастер заявки грузит сотрудников сам и должен
 * узнать о новом, не закрываясь.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() },
}));

const { createStudentAction } = vi.hoisted(() => ({ createStudentAction: vi.fn() }));
vi.mock('@/server-actions/students', () => ({ createStudentAction }));

import { AddStudentDialog } from '@/components/students/add-student-dialog';

beforeEach(() => {
  refresh.mockClear();
  toastSuccess.mockClear();
  createStudentAction.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function openDialog(props: Partial<React.ComponentProps<typeof AddStudentDialog>> = {}) {
  render(React.createElement(AddStudentDialog, { organizationId: 'o1', ...props }));
  fireEvent.click(screen.getByTestId('add-student-open'));
  return screen.getByTestId('add-student-form');
}

function fillName(form: HTMLElement, value = 'Иванов Иван') {
  fireEvent.change(within(form).getByPlaceholderText('Иванов Иван Иванович'), {
    target: { value },
  });
}

describe('AddStudentDialog', () => {
  it('успех: тост, обновление страницы и обратный вызов; в форму подставлена организация', async () => {
    createStudentAction.mockResolvedValue({ ok: true });
    const onCreated = vi.fn();
    const form = openDialog({ onCreated });
    fillName(form);
    fireEvent.submit(form);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Сотрудник добавлен'));
    expect(refresh).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledTimes(1);
    const fd = createStudentAction.mock.calls[0]![0] as FormData;
    expect(fd.get('organizationId')).toBe('o1');
    expect(fd.get('force')).toBeNull();
  });

  it('успех без onCreated (кабинеты) — падать нечему', async () => {
    createStudentAction.mockResolvedValue({ ok: true });
    const form = openDialog();
    fillName(form);
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('дубль не блокирует: показываем найденных и даём «Всё равно добавить» (force)', async () => {
    createStudentAction.mockResolvedValueOnce({
      ok: false,
      error: 'duplicate_found',
      match: 'snils',
      candidates: [
        { id: 's1', name: 'Иванов Иван', position: 'Электромонтёр', status: 'active' },
        { id: 's2', name: 'Иванов Иван', position: null, status: 'inactive' },
      ],
    });
    const form = openDialog();
    fillName(form);
    fireEvent.submit(form);

    const box = await screen.findByTestId('add-student-duplicates');
    expect(box.textContent).toContain('по СНИЛС');
    expect(box.textContent).toContain('Электромонтёр');
    expect(box.textContent).toContain('деактивирован');

    createStudentAction.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByTestId('add-student-force'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const fd = createStudentAction.mock.calls[1]![0] as FormData;
    expect(fd.get('force')).toBe('1');
  });

  it('ошибки сервера показываются человеку: validation, forbidden и прочее', async () => {
    createStudentAction.mockResolvedValueOnce({
      ok: false,
      error: 'validation',
      messages: ['Укажите ФИО'],
    });
    const form = openDialog();
    fillName(form);
    fireEvent.submit(form);
    // role=alert тут не годится: примитив Dialog держит собственный
    // всегда-смонтированный aria-live регион с той же ролью (CLAUDE.md §9).
    expect(await screen.findByText('Укажите ФИО')).toBeTruthy();

    createStudentAction.mockResolvedValueOnce({ ok: false, error: 'validation' });
    fireEvent.submit(form);
    expect(await screen.findByText('Проверьте заполнение полей.')).toBeTruthy();

    createStudentAction.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    fireEvent.submit(form);
    expect(
      await screen.findByText('Нет прав добавлять сотрудников в эту организацию.')
    ).toBeTruthy();

    createStudentAction.mockResolvedValueOnce({ ok: false, error: 'storage' });
    fireEvent.submit(form);
    expect(
      await screen.findByText('Не удалось добавить сотрудника. Попробуйте ещё раз.')
    ).toBeTruthy();
  });

  it('«Отмена» закрывает диалог, а во время сохранения — нет', async () => {
    // Definite assignment: присваивание происходит внутри колбэка Promise,
    // TS этого не видит и без «!» сужает тип до null.
    let finish!: (v: unknown) => void;
    createStudentAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const form = openDialog();
    fillName(form);
    fireEvent.submit(form);

    // Пока идёт сохранение, закрытие игнорируется — иначе можно потерять ввод.
    await waitFor(() => expect(screen.getByText('Сохраняю…')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByTestId('add-student-form')).toBeTruthy();

    finish({ ok: false, error: 'validation', messages: ['стоп'] });
    expect(await screen.findByText('стоп')).toBeTruthy();

    // Сохранение закончилось — «Отмена» снова работает и стирает ошибку.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByText('стоп')).toBeNull());
  });
});
