// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Действия сотрудника над заявкой на обучение (`У-116`).
 *
 * Кнопки показываются по состоянию заявки, а правило переходов живёт на
 * сервере. Здесь проверяется то, что видит человек: какие кнопки есть в каждом
 * состоянии, что спрашивается перед необратимым шагом и что экран без кнопок
 * **объясняет** их отсутствие, а не молчит (§15).
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

import { EnrollmentStaffActions } from '@/components/enrollment/enrollment-staff-actions';

type Item = { id: string; status: string };

const enrollment = (
  over: Partial<{ status: string; studentCount: number; items: Item[] }> = {}
) => ({
  id: 'e1',
  status: 'pending',
  studentCount: 1,
  items: [] as Item[],
  ...over,
});

/** Успешный ответ сервера. */
function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', okFetch());
});

describe('какие кнопки показываются', () => {
  it('новая заявка — «Утвердить» и «Отклонить»', () => {
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    expect(screen.getByRole('button', { name: 'Утвердить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Зачислены' })).toBeNull();
  });

  it('утверждённая — «Зачислены» и «Отклонить», но не «Утвердить»', () => {
    render(<EnrollmentStaffActions enrollment={enrollment({ status: 'approved' })} />);

    expect(screen.getByRole('button', { name: 'Зачислены' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Утвердить' })).toBeNull();
  });

  it('есть зачисленные строки — появляется «Идёт обучение»', () => {
    render(
      <EnrollmentStaffActions
        enrollment={enrollment({
          status: 'provisioned',
          items: [{ id: 'i1', status: 'provisioned' }],
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Идёт обучение' })).toBeTruthy();
  });

  it('есть обучающиеся строки — появляется «Удостоверения готовы»', () => {
    render(
      <EnrollmentStaffActions
        enrollment={enrollment({
          status: 'in_training',
          items: [{ id: 'i1', status: 'in_training' }],
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Удостоверения готовы' })).toBeTruthy();
  });

  it('путь пройден — экран объясняет, почему кнопок нет', () => {
    render(
      <EnrollmentStaffActions
        enrollment={enrollment({ status: 'done', items: [{ id: 'i1', status: 'certificates' }] })}
      />
    );

    expect(screen.getByText('Заявка прошла весь путь — действий над ней больше нет.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('что делает нажатие', () => {
  it('«Утвердить» шлёт действие на сервер и перечитывает страницу', async () => {
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/enrollments/e1');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ action: 'approve' });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Заявка утверждена'));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('одиночной заявке идентификатор в LMS обязателен — пустой не отправляется', () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '   ')
    );
    render(<EnrollmentStaffActions enrollment={enrollment({ status: 'approved' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('у заявки на нескольких общий идентификатор можно не указывать', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '')
    );
    render(
      <EnrollmentStaffActions enrollment={enrollment({ status: 'approved', studentCount: 3 })} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: 'markProvisioned',
      externalStudentId: '',
    });
  });

  it('отказ от ввода идентификатора ничего не отправляет', () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => null)
    );
    render(<EnrollmentStaffActions enrollment={enrollment({ status: 'approved' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('введённый идентификатор уходит без лишних пробелов', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '  LMS-42  ')
    );
    render(<EnrollmentStaffActions enrollment={enrollment({ status: 'approved' })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: 'markProvisioned',
      externalStudentId: 'LMS-42',
    });
  });

  it('«Идёт обучение» и «Удостоверения готовы» шлют свои действия', async () => {
    render(
      <EnrollmentStaffActions
        enrollment={enrollment({
          status: 'provisioned',
          items: [
            { id: 'i1', status: 'provisioned' },
            { id: 'i2', status: 'in_training' },
          ],
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Отмечено: идёт обучение'));

    fireEvent.click(screen.getByRole('button', { name: 'Удостоверения готовы' }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Отмечено: удостоверения готовы')
    );
  });

  it('отклонение спрашивает причину и передаёт её', async () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => 'нет мест')
    );
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: 'reject',
      reason: 'нет мест',
    });
  });

  it('отказ от ввода причины отклонение отменяет', () => {
    vi.stubGlobal(
      'prompt',
      vi.fn(() => null)
    );
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('когда сервер отказал', () => {
  it('причина сервера показывается человеку', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'заявка уже утверждена' }),
      }))
    );
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Не удалось: заявка уже утверждена')
    );
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('ответ без причины показывает хотя бы код — не пустоту', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('не json');
        },
      }))
    );
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Не удалось: 500'));
  });

  it('сеть не ответила — говорим прямо, а не молчим', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('нет сети');
      })
    );
    render(<EnrollmentStaffActions enrollment={enrollment()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Сетевая ошибка'));
  });
});
