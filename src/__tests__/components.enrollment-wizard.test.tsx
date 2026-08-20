// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

/**
 * Мастер подачи заявки после перестройки этапа 6 (`У-37`…`У-42`).
 *
 * Ключевое отличие от прежних тестов: направление выбирается **у строки**, а не
 * на первом шаге; галочки в списке сотрудников — это ВЫБОР для массового
 * назначения, а не мгновенное добавление в заявку.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

const { createStudentAction } = vi.hoisted(() => ({ createStudentAction: vi.fn() }));
vi.mock('@/server-actions/students', () => ({ createStudentAction }));

import { EnrollmentWizard, validateRowsClient } from '@/components/enrollment/enrollment-wizard';

const DIRECTIONS = [
  { id: 'd1', name: 'Охрана труда' },
  { id: 'd2', name: 'Пожарная безопасность' },
];
const ORGS = [
  { id: 'o1', name: 'ООО Ромашка' },
  { id: 'o2', name: 'ООО Василёк' },
];
const STUDENTS = [
  { id: 'st1', name: 'Пётр Петров', email: 'p@org.ru' },
  { id: 'st2', name: 'Анна Иванова', email: 'a@org.ru' },
];

function fetchMockOk() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/enrollments/students')) {
      return { ok: true, json: async () => ({ students: STUDENTS }) };
    }
    return { ok: true, json: async () => ({ itemCount: 1, warnings: [] }) };
  });
}

beforeEach(() => {
  refresh.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
  createStudentAction.mockReset();
  // jsdom не умеет нативный <dialog> — примитив Dialog зовёт showModal/close
  // (CLAUDE.md §9), поэтому их подменяем.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWizard(props: Partial<React.ComponentProps<typeof EnrollmentWizard>> = {}) {
  return render(React.createElement(EnrollmentWizard, { directions: DIRECTIONS, ...props }));
}

function goStep2() {
  fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
}

/** Отметить сотрудников галочками и назначить им обучение (`У-39`). */
function assign(directionId: string, names: string[]) {
  for (const name of names) {
    const row = screen.getByText(name).closest('label') as HTMLLabelElement;
    fireEvent.click(within(row).getByRole('checkbox'));
  }
  fireEvent.change(screen.getByLabelText('Обучение для отмеченных сотрудников'), {
    target: { value: directionId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Назначить отмеченным' }));
}

describe('validateRowsClient', () => {
  const base = {
    key: 'k',
    studentId: null,
    directionId: 'd1',
    fullName: '',
    email: '',
    position: '',
    snils: '',
    birthDate: '',
    extra: '',
  };
  it('пусто → «хотя бы одного»; ошибки ФИО/email/СНИЛС адресные', () => {
    expect(validateRowsClient([])).toEqual(['Добавьте хотя бы одного слушателя']);
    const errors = validateRowsClient([
      { ...base },
      { ...base, key: 'k2', fullName: 'Иван', email: 'плохо', snils: '123' },
    ]);
    expect(errors).toContain('Слушатель 1: не указано ФИО');
    expect(errors).toContain('Слушатель 1: не указан email');
    expect(errors.some((e) => e.includes('Иван: некорректный email'))).toBe(true);
    expect(errors.some((e) => e.includes('СНИЛС'))).toBe(true);
  });

  it('позиция из сотрудников (studentId) не требует ФИО/email', () => {
    expect(validateRowsClient([{ ...base, studentId: 'st1' }])).toEqual([]);
  });

  it('У-38: строка без обучения — ошибка', () => {
    expect(validateRowsClient([{ ...base, studentId: 'st1', directionId: '' }])).toEqual([
      'Слушатель 1: не выбрано обучение',
    ]);
  });

  it('У-35: тот же человек на РАЗНЫЕ обучения — ок, на одно и то же дважды — ошибка', () => {
    expect(
      validateRowsClient([
        { ...base, studentId: 'st1', directionId: 'd1' },
        { ...base, key: 'k2', studentId: 'st1', directionId: 'd2' },
      ])
    ).toEqual([]);

    const dupe = validateRowsClient([
      { ...base, fullName: 'Иван', email: 'i@x.ru', directionId: 'd1' },
      { ...base, key: 'k2', fullName: 'Иван', email: 'I@X.RU', directionId: 'd1' },
    ]);
    expect(dupe).toEqual(['Иван: это обучение уже добавлено ему в заявку']);
  });
});

describe('EnrollmentWizard — шаг 1 (организация)', () => {
  it('пустой справочник направлений: подсказка и заблокированная кнопка', () => {
    renderWizard({ directions: [] });
    expect(screen.getByText(/Справочник направлений пуст/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Далее: слушатели' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('У-37: на первом шаге выбирают ОРГАНИЗАЦИЮ, направления здесь больше нет', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ organizations: ORGS });
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.queryByText('— выберите направление —')).toBeNull();
    goStep2();
    expect(screen.getByText(/Шаг 2 из 3/)).toBeTruthy();
  });

  it('без списка организаций (кабинет организации) — поясняющая строка вместо селекта', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    expect(screen.getByText(/Заявка подаётся от вашей организации/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('EnrollmentWizard — шаг 2 (слушатели и обучения)', () => {
  it('без организации — подсказка и ручное добавление; валидация ловит пустую строку', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    goStep2();
    expect(screen.getByText(/Организация не выбрана/)).toBeTruthy();
    expect(screen.getByText(/Пока пусто/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Слушатель 1: не указано ФИО')).toBeTruthy();
    expect(screen.getByText('Слушатель 1: не выбрано обучение')).toBeTruthy();
  });

  it('У-39: массовое назначение добавляет строки; повтор с другим обучением ДОБАВЛЯЕТ второй набор', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    expect(await screen.findByText('Пётр Петров')).toBeTruthy();

    assign('d1', ['Пётр Петров', 'Анна Иванова']);
    expect(screen.getByText('Строк в заявке: 2')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith('Добавлено обучений «Охрана труда»: 2');

    // Тем же людям — второе обучение. Прежние строки остаются.
    assign('d2', ['Пётр Петров', 'Анна Иванова']);
    expect(screen.getByText('Строк в заявке: 4')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith('Добавлено обучений «Пожарная безопасность»: 2');
  });

  it('У-35: повторное назначение ТОГО ЖЕ обучения не плодит дубли, а сообщает об этом', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');

    assign('d1', ['Пётр Петров']);
    assign('d1', ['Пётр Петров', 'Анна Иванова']);

    expect(screen.getByText('Строк в заявке: 2')).toBeTruthy();
    expect(toastInfo).toHaveBeenCalledWith('Уже было в заявке: 1');
  });

  it('У-38: «+ ещё обучение» повторяет человека новой строкой с пустым обучением', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');
    assign('d1', ['Пётр Петров']);

    fireEvent.click(screen.getByRole('button', { name: '+ ещё обучение' }));
    expect(screen.getByText('Строк в заявке: 2')).toBeTruthy();
    expect((screen.getByLabelText('Обучение для строки 1') as HTMLSelectElement).value).toBe('d1');
    expect((screen.getByLabelText('Обучение для строки 2') as HTMLSelectElement).value).toBe('');
    // ФИО скопировано — это тот же сотрудник.
    expect(screen.getAllByDisplayValue('Пётр Петров')).toHaveLength(2);
  });

  it('поиск фильтрует список; при пустом результате — понятное сообщение', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');

    fireEvent.change(screen.getByPlaceholderText('Поиск по ФИО или email'), {
      target: { value: 'анна' },
    });
    expect(screen.queryByText('Пётр Петров')).toBeNull();
    expect(screen.getByText('Анна Иванова')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Поиск по ФИО или email'), {
      target: { value: 'нет таких' },
    });
    expect(screen.getByText('Никого не нашли по запросу.')).toBeTruthy();
  });

  it('кнопка назначения заблокирована, пока никто не отмечен или не выбрано обучение', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');

    const button = () =>
      screen.getByRole('button', { name: 'Назначить отмеченным' }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    const row = screen.getByText('Пётр Петров').closest('label') as HTMLLabelElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(button().disabled).toBe(true); // обучение ещё не выбрано

    fireEvent.change(screen.getByLabelText('Обучение для отмеченных сотрудников'), {
      target: { value: 'd1' },
    });
    expect(button().disabled).toBe(false);

    // Снятие галочки снова блокирует.
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(button().disabled).toBe(true);
  });

  it('смена организации перезагружает список и снимает отметки', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('organizationId=o2')) {
        return { ok: true, json: async () => ({ students: [] }) };
      }
      return { ok: true, json: async () => ({ students: STUDENTS }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ organizations: ORGS });

    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'o1' } });
    goStep2();
    await screen.findByText('Пётр Петров');
    assign('d1', ['Пётр Петров']);
    expect(screen.getByText('Строк в заявке: 1')).toBeTruthy();

    // Возврат на шаг 1 и смена организации: сотрудник другой организации уходит.
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'o2' } });
    goStep2();
    expect(await screen.findByText(/нет сотрудников этой организации/)).toBeTruthy();
    expect(screen.getByText('Строк в заявке: 0')).toBeTruthy();
  });

  it('ошибка ответа (500) и сетевой сбой деградируют в пустой список', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    const first = renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    expect(await screen.findByText(/нет сотрудников этой организации/)).toBeTruthy();
    first.unmount();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    expect(await screen.findByText(/нет сотрудников этой организации/)).toBeTruthy();
  });

  it('ручная строка правится и удаляется; правка одной не трогает соседнюю', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    goStep2();
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));

    const names = screen.getAllByPlaceholderText('ФИО *') as HTMLInputElement[];
    fireEvent.change(names[0]!, { target: { value: 'Первый' } });
    expect((screen.getAllByPlaceholderText('ФИО *')[1] as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getAllByPlaceholderText('Email *')[0]!, {
      target: { value: 'i@x.ru' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Должность')[0]!, {
      target: { value: 'инженер' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('СНИЛС (11 цифр)')[0]!, {
      target: { value: '112-233-445 95' },
    });
    fireEvent.change(document.querySelectorAll('input[type="date"]')[0]!, {
      target: { value: '1990-01-01' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('Любая дополнительная информация')[0]!, {
      target: { value: 'группа 2' },
    });
    expect(screen.getByDisplayValue('группа 2')).toBeTruthy();

    fireEvent.click(screen.getAllByText('Удалить')[0]!);
    expect(screen.getByText('Строк в заявке: 1')).toBeTruthy();
  });

  it('У-40: диалог «Добавить сотрудника» открывается в мастере и перечитывает список', async () => {
    const fetchMock = fetchMockOk();
    vi.stubGlobal('fetch', fetchMock);
    createStudentAction.mockResolvedValue({ ok: true });
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');
    const callsBefore = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).startsWith('/api/enrollments/students')
    ).length;

    fireEvent.click(screen.getByTestId('add-student-open'));
    const form = screen.getByTestId('add-student-form');
    fireEvent.change(within(form).getByPlaceholderText('Иванов Иван Иванович'), {
      target: { value: 'Новый Сотрудник' },
    });
    fireEvent.submit(form);

    // Мастер остался на шаге 2, а список сотрудников перезапрошен.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c: unknown[]) =>
          String(c[0]).startsWith('/api/enrollments/students')
        ).length
      ).toBe(callsBefore + 1)
    );
    expect(screen.getByText(/Шаг 2 из 3/)).toBeTruthy();
  });

  it('кнопка «Назад» возвращает на шаг 1', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    goStep2();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText(/Шаг 1 из 3/)).toBeTruthy();
  });

  it('уход со страницы во время загрузки сотрудников не роняет мастер', async () => {
    // Ответ может прийти после размонтирования (клиент ушёл со страницы).
    // Флаг cancelled защищает от setState на размонтированном компоненте.
    let resolveFetch: ((v: unknown) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const { unmount } = renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    unmount();
    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({ students: STUDENTS }) });
    });
    // Достаточно того, что не было unhandled rejection/ошибки React.
  });
});

describe('EnrollmentWizard — шаг 3 и отправка', () => {
  async function fillToStep3(fetchMock = fetchMockOk()) {
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ organizations: ORGS, defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');
    assign('d1', ['Пётр Петров']);
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    return fetchMock;
  }

  it('У-42: сводка «N слушателей · M обучений» с разбивкой; сабмит шлёт направление у каждой позиции', async () => {
    const fetchMock = fetchMockOk();
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ organizations: ORGS, defaultOrganizationId: 'o1' });
    goStep2();
    await screen.findByText('Пётр Петров');
    // Один человек на два обучения + второй человек на одно: 2 слушателя, 3 обучения.
    assign('d1', ['Пётр Петров', 'Анна Иванова']);
    assign('d2', ['Пётр Петров']);
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));

    expect(screen.getByText(/Шаг 3 из 3/)).toBeTruthy();
    expect(screen.getByText('2 слушателя · 3 обучения')).toBeTruthy();
    expect(screen.getByText('Охрана труда: 2 слушателя')).toBeTruthy();
    expect(screen.getByText('Пожарная безопасность: 1 слушатель')).toBeTruthy();
    expect(screen.getByText(/Организация: ООО Ромашка/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' срочно ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Заявка на обучение отправлена (обучений: 1)')
    );
    const submitCall = fetchMock.mock.calls.find((c: unknown[]) => c[0] === '/api/enrollments')!;
    const body = JSON.parse((submitCall[1] as { body: string }).body);
    expect(body).toMatchObject({
      organizationId: 'o1',
      note: 'срочно',
    });
    // `У-36`: шапочного направления в теле больше нет — источник один, позиции.
    expect(body.directionId).toBeUndefined();
    expect(body.items).toEqual([
      expect.objectContaining({ studentId: 'st1', directionId: 'd1' }),
      expect.objectContaining({ studentId: 'st2', directionId: 'd1' }),
      expect.objectContaining({ studentId: 'st1', directionId: 'd2' }),
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/Шаг 1 из 3/)).toBeTruthy();
  });

  it('итог перечисляет обучение и должность каждой строки', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    goStep2();
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));
    fireEvent.change(screen.getByPlaceholderText('ФИО *'), { target: { value: 'Иван Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'i@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('Должность'), { target: { value: 'Инженер' } });
    fireEvent.change(screen.getByLabelText('Обучение для строки 1'), { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));

    expect(screen.getByText('· Пожарная безопасность')).toBeTruthy();
    expect(screen.getByText('· Инженер')).toBeTruthy();
    expect(screen.getByText('1 слушатель · 1 обучение')).toBeTruthy();
  });

  it('warnings сервера показываются toast.info', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      return {
        ok: true,
        json: async () => ({ itemCount: 1, warnings: ['Слушатель 2: дубликат — объединён'] }),
      };
    });
    await fillToStep3(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith('Слушатель 2: дубликат — объединён')
    );
  });

  it('заявка без организации уходит с organizationId=null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itemCount: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();
    goStep2();
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));
    fireEvent.change(screen.getByPlaceholderText('ФИО *'), { target: { value: 'Иван Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'i@x.ru' } });
    fireEvent.change(screen.getByLabelText('Обучение для строки 1'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/enrollments', expect.anything())
    );
    const sent = JSON.parse((fetchMock.mock.calls.at(-1)![1] as { body: string }).body);
    expect(sent.organizationId).toBeNull();
    expect(sent.note).toBeNull();
    // Ответ без поля warnings вовсе — toast.info не зовём.
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('ответ-ошибка с неразбираемым телом → toast со статус-кодом', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      };
    });
    await fillToStep3(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось отправить заявку: 502')
    );
  });

  it('400 с messages → список ошибок в role=alert', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: 'validation',
          messages: ['Направление слушателя не найдено или неактивно'],
        }),
      };
    });
    await fillToStep3(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText('Направление слушателя не найдено или неактивно')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ошибка без messages → toast с кодом; сетевая ошибка → «Сетевая ошибка»', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      return { ok: false, status: 403, json: async () => ({ error: 'forbidden', messages: [] }) };
    });
    await fillToStep3(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось отправить заявку: forbidden')
    );

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      throw new Error('down');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('«Назад» с шага 3 возвращает на шаг 2', async () => {
    await fillToStep3();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText(/Шаг 2 из 3/)).toBeTruthy();
  });
});
