// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Этап 9 PR-3 (ФТ-12.2): форма должности сотрудника в его карточке. Поле
 * необязательное — пустое значение допустимо; ошибки сервиса локализуются.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success } }));

const { updateStudentPositionAction } = vi.hoisted(() => ({
  updateStudentPositionAction: vi.fn(),
}));
vi.mock('@/server-actions/organization/students', () => ({ updateStudentPositionAction }));

import { StudentPositionForm } from '@/components/organization/student-position-form';

const props = { organizationId: 'orgA', studentId: 's1', initialPosition: 'Инженер' };

beforeEach(() => {
  vi.clearAllMocks();
  updateStudentPositionAction.mockResolvedValue({ ok: true });
});

describe('StudentPositionForm', () => {
  it('показывает текущую должность и скрытые поля скоупа', () => {
    const { container } = render(React.createElement(StudentPositionForm, props));
    expect(
      (screen.getByPlaceholderText(/инженер по охране труда/i) as HTMLInputElement).value
    ).toBe('Инженер');
    expect(container.querySelector('input[name="organizationId"]')?.getAttribute('value')).toBe(
      'orgA'
    );
    expect(container.querySelector('input[name="studentId"]')?.getAttribute('value')).toBe('s1');
  });

  it('пустая должность допустима — форма отправляется и показывает toast', async () => {
    render(React.createElement(StudentPositionForm, { ...props, initialPosition: null }));
    const input = screen.getByPlaceholderText(/инженер по охране труда/i);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(updateStudentPositionAction).toHaveBeenCalledTimes(1));
    const fd = updateStudentPositionAction.mock.calls[0]![0] as FormData;
    expect(fd.get('position')).toBe('');
    await waitFor(() => expect(success).toHaveBeenCalledWith('Должность сохранена'));
  });

  it('сохраняет введённое значение', async () => {
    render(React.createElement(StudentPositionForm, { ...props, initialPosition: null }));
    fireEvent.change(screen.getByPlaceholderText(/инженер по охране труда/i), {
      target: { value: 'Главный энергетик' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(updateStudentPositionAction).toHaveBeenCalled());
    const fd = updateStudentPositionAction.mock.calls[0]![0] as FormData;
    expect(fd.get('position')).toBe('Главный энергетик');
  });

  it('ошибка сервиса показывается по-русски', async () => {
    updateStudentPositionAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(StudentPositionForm, props));
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Сотрудник не найден в вашей организации.')
    );
    expect(success).not.toHaveBeenCalled();
  });

  it('слишком длинная должность — своя подпись ошибки', async () => {
    updateStudentPositionAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(React.createElement(StudentPositionForm, props));
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('не больше 200 символов')
    );
  });

  it('во время отправки кнопка блокируется и меняет подпись', async () => {
    let release: (v: { ok: true }) => void = () => {};
    updateStudentPositionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    render(React.createElement(StudentPositionForm, props));
    fireEvent.click(screen.getByText('Сохранить'));

    await waitFor(() => expect(screen.getByText('Сохраняем…')).toBeTruthy());
    expect((screen.getByText('Сохраняем…') as HTMLButtonElement).disabled).toBe(true);

    release({ ok: true });
    await waitFor(() => expect(screen.getByText('Сохранить')).toBeTruthy());
  });
});
