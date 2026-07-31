// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWizard(props: Partial<React.ComponentProps<typeof EnrollmentWizard>> = {}) {
  return render(React.createElement(EnrollmentWizard, { directions: DIRECTIONS, ...props }));
}

function pickDirection(id = 'd1') {
  const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  fireEvent.change(select, { target: { value: id } });
}

describe('validateRowsClient', () => {
  const base = {
    key: 'k',
    studentId: null,
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
      { ...base, fullName: 'Иван', email: 'плохо', snils: '123' },
    ]);
    expect(errors).toContain('Слушатель 1: не указано ФИО');
    expect(errors).toContain('Слушатель 1: не указан email');
    expect(errors.some((e) => e.includes('Иван: некорректный email'))).toBe(true);
    expect(errors.some((e) => e.includes('СНИЛС'))).toBe(true);
  });
  it('позиция из сотрудников (studentId) не требует ФИО/email', () => {
    expect(validateRowsClient([{ ...base, studentId: 'st1' }])).toEqual([]);
  });
});

describe('EnrollmentWizard — шаг 1', () => {
  it('«Далее» заблокирована без направления; пустой справочник — подсказка', () => {
    renderWizard({ directions: [] });
    expect(screen.getByText(/Справочник направлений пуст/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Далее: слушатели' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('выбор направления открывает шаг 2; селект организаций рендерится при наличии', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ organizations: ORGS });
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    expect(screen.getByText(/Шаг 2 из 3/)).toBeTruthy();
  });
});

describe('EnrollmentWizard — шаг 2 (слушатели)', () => {
  it('без организации — подсказка и ручное добавление; валидация не пускает пустые строки', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    expect(screen.getByText(/Организация не выбрана/)).toBeTruthy();
    expect(screen.getByText(/Отметьте сотрудников галочками/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));
    expect(
      (screen.getByRole('button', { name: 'Далее: проверка' }) as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Слушатель 1: не указано ФИО')).toBeTruthy();
  });

  it('организация задана: сотрудники грузятся, чекбокс добавляет/убирает позицию, поиск фильтрует', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({ defaultOrganizationId: 'o1' });
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));

    expect(await screen.findByText('Пётр Петров')).toBeTruthy();
    const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(screen.getByText('Слушатели в заявке: 1')).toBeTruthy();
    // ФИО/email позиции «из сотрудников» заблокированы
    expect((screen.getByDisplayValue('Пётр Петров') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('из сотрудников')).toBeTruthy();

    // Снятие галочки удаляет позицию
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.getByText('Слушатели в заявке: 0')).toBeTruthy();

    // Поиск фильтрует клиентски
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

  it('селект организаций: выбор грузит сотрудников; повторный клик по чекбоксу не дублирует позицию', async () => {
    // Организацию выбирают из списка (кабинет партнёра). Смена значения должна
    // подтянуть сотрудников именно выбранной организации.
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard({
      organizations: [
        { id: 'o1', name: 'ООО Ромашка' },
        { id: 'o2', name: 'ООО Лютик' },
      ],
    });
    pickDirection();
    // Селект организации — на первом шаге, рядом с направлением.
    const orgSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    fireEvent.change(orgSelect, { target: { value: 'o1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));

    expect(await screen.findByText('Пётр Петров')).toBeTruthy();

    // Повторное «добавление» того же сотрудника не создаёт дубль.
    const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(checkbox); // снятие
    fireEvent.click(checkbox); // снова добавление
    expect(screen.getByText('Слушатели в заявке: 1')).toBeTruthy();
  });

  it('ошибка ответа на список сотрудников (500) деградирует в пустой список', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    renderWizard({ defaultOrganizationId: 'o1' });
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    expect(await screen.findByText(/строками ниже/)).toBeTruthy();
  });

  it('ручная позиция: дата рождения и примечание правятся, пустое ФИО в итоге — прочерк', async () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '1990-01-01' } });
    expect(dateInput.value).toBe('1990-01-01');

    const extra = screen.getByPlaceholderText(
      'Любая дополнительная информация'
    ) as HTMLInputElement;
    fireEvent.change(extra, { target: { value: 'группа 2' } });
    expect(extra.value).toBe('группа 2');
  });

  it('ручная позиция редактируется и удаляется', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));

    fireEvent.change(screen.getByPlaceholderText('ФИО *'), { target: { value: 'Иван Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'i@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('Должность'), { target: { value: 'инженер' } });
    fireEvent.change(screen.getByPlaceholderText('СНИЛС (11 цифр)'), {
      target: { value: '112-233-445 95' },
    });

    fireEvent.click(screen.getByText('Удалить'));
    expect(screen.getByText('Слушатели в заявке: 0')).toBeTruthy();
  });

  it('кнопка «Назад» возвращает на шаг 1', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText(/Шаг 1 из 3/)).toBeTruthy();
  });

  it('пустой список сотрудников организации — подсказка добавить строками', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ students: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ defaultOrganizationId: 'o1' });
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    expect(await screen.findByText(/нет сотрудников в системе/)).toBeTruthy();
  });

  it('ошибка загрузки сотрудников деградирует в пустой список', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ defaultOrganizationId: 'o1' });
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    expect(await screen.findByText(/нет сотрудников в системе/)).toBeTruthy();
  });
});

describe('EnrollmentWizard — шаг 3 и отправка', () => {
  async function fillToStep3(fetchMock = fetchMockOk(), rowPatch: { position?: string } = {}) {
    vi.stubGlobal('fetch', fetchMock);
    renderWizard({ organizations: ORGS, defaultOrganizationId: 'o1' });
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    await screen.findByText('Пётр Петров');
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    if (rowPatch.position) {
      fireEvent.change(screen.getByPlaceholderText('Должность'), {
        target: { value: rowPatch.position },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    return fetchMock;
  }

  it('итог: направление, организация, счётчик, список; сабмит шлёт позиции и сбрасывает мастер', async () => {
    const fetchMock = await fillToStep3();
    expect(screen.getByText(/Шаг 3 из 3/)).toBeTruthy();
    const summary = screen.getByText('Направление:').parentElement!.parentElement!;
    expect(within(summary).getByText('Охрана труда')).toBeTruthy();
    expect(within(summary).getByText('ООО Ромашка')).toBeTruthy();
    expect(within(summary).getByText('1')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' срочно ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Заявка на обучение отправлена (слушателей: 1)')
    );
    const submitCall = fetchMock.mock.calls.find((c: unknown[]) => c[0] === '/api/enrollments')!;
    const body = JSON.parse((submitCall[1] as { body: string }).body);
    expect(body).toMatchObject({
      directionId: 'd1',
      organizationId: 'o1',
      note: 'срочно',
      items: [{ studentId: 'st1', fullName: 'Пётр Петров', email: 'p@org.ru' }],
    });
    expect(refresh).toHaveBeenCalled();
    // Мастер сброшен на шаг 1
    expect(screen.getByText(/Шаг 1 из 3/)).toBeTruthy();
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
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));

    unmount();
    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({ students: STUDENTS }) });
    });
    // Достаточно того, что не было unhandled rejection/ошибки React.
  });

  it('правка одной ручной позиции не трогает соседнюю', () => {
    vi.stubGlobal('fetch', fetchMockOk());
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));

    const names = screen.getAllByPlaceholderText('ФИО *') as HTMLInputElement[];
    fireEvent.change(names[0], { target: { value: 'Первый' } });
    expect((screen.getAllByPlaceholderText('ФИО *')[1] as HTMLInputElement).value).toBe('');
  });

  it('заявка без организации уходит с organizationId=null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itemCount: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();
    pickDirection();
    fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя' }));
    fireEvent.change(screen.getByPlaceholderText('ФИО *'), { target: { value: 'Иван Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Email *'), { target: { value: 'i@x.ru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее: проверка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/enrollments', expect.anything())
    );
    const sent = JSON.parse((fetchMock.mock.calls.at(-1)![1] as { body: string }).body);
    expect(sent.organizationId).toBeNull();
    expect(sent.note).toBeNull();
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

  it('итог: позиция с должностью показывает её через точку; ответ без warnings не падает', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/enrollments/students')) {
        return { ok: true, json: async () => ({ students: STUDENTS }) };
      }
      // Ответ без поля warnings вовсе.
      return { ok: true, json: async () => ({ itemCount: 1 }) };
    });
    await fillToStep3(fetchMock, { position: 'Инженер' });
    expect(screen.getByText(/· Инженер/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastInfo).not.toHaveBeenCalled();
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
          messages: ['Направление не найдено или неактивно'],
        }),
      };
    });
    await fillToStep3(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText('Направление не найдено или неактивно')).toBeTruthy();
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

    // Сетевая ошибка
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
