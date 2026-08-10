// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

const { parseEnrollmentImportAction } = vi.hoisted(() => ({
  parseEnrollmentImportAction: vi.fn(),
}));
vi.mock('@/server-actions/enrollment-import', () => ({ parseEnrollmentImportAction }));

const { createStudentAction } = vi.hoisted(() => ({ createStudentAction: vi.fn() }));
vi.mock('@/server-actions/students', () => ({ createStudentAction }));

import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';

const DIRECTIONS = [
  { id: 'd1', name: 'Охрана труда' },
  { id: 'd2', name: 'Работы на высоте' },
];

function importedItem(overrides: Record<string, unknown> = {}) {
  return {
    studentId: null,
    directionId: null,
    fullName: 'Мария Кузнецова',
    email: 'maria@example.com',
    position: null,
    snils: null,
    birthDate: null,
    extra: null,
    ...overrides,
  };
}

/** Шаг 1 → шаг 2. Направления на первом шаге больше нет (`У-37`). */
function goToStep2() {
  render(React.createElement(EnrollmentWizard, { directions: DIRECTIONS }));
  fireEvent.click(screen.getByRole('button', { name: 'Далее: слушатели' }));
  expect(screen.getByText(/Шаг 2 из 3/)).toBeTruthy();
}

function uploadFile(name = 'students.xlsx') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  expect(input.accept).toBe('.xlsx');
  const file = new File(['fake'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('EnrollmentWizard — импорт из Excel (шаг 2)', () => {
  beforeEach(() => {
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    parseEnrollmentImportAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ссылка «Скачать шаблон» ведёт на /api/enrollments/import-template', () => {
    goToStep2();
    const link = screen.getByRole('link', { name: 'Скачать шаблон' });
    expect(link.getAttribute('href')).toBe('/api/enrollments/import-template');
  });

  it('успешный импорт: строки добавлены, счётчик обновлён, toast.success, файл ушёл в action', async () => {
    parseEnrollmentImportAction.mockResolvedValue({
      ok: true,
      items: [
        importedItem(),
        importedItem({ fullName: 'Олег Смирнов', email: 'oleg@example.com', position: 'инженер' }),
      ],
      errors: [],
      warnings: [],
    });
    goToStep2();
    const file = uploadFile();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Импортировано строк: 2'));
    expect(screen.getByText('Строк в заявке: 2')).toBeTruthy();
    expect(screen.getByDisplayValue('Мария Кузнецова')).toBeTruthy();
    expect(screen.getByDisplayValue('oleg@example.com')).toBeTruthy();
    expect(screen.getByDisplayValue('инженер')).toBeTruthy();
    // Action получает FormData с файлом под ключом file
    const form = parseEnrollmentImportAction.mock.calls[0]![0] as FormData;
    expect(form.get('file')).toBe(file);
    // Ни ошибок, ни предупреждений не показано
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('У-41: направление из файла подставляется в строку', async () => {
    parseEnrollmentImportAction.mockResolvedValue({
      ok: true,
      items: [importedItem({ directionId: 'd2' })],
      errors: [],
      warnings: [],
    });
    goToStep2();
    uploadFile();

    await waitFor(() => expect(screen.getByDisplayValue('Мария Кузнецова')).toBeTruthy());
    const rowSelect = screen.getByLabelText('Обучение для строки 1') as HTMLSelectElement;
    expect(rowSelect.value).toBe('d2');
  });

  it('импортированная дата рождения приводится к формату поля даты', async () => {
    // Excel отдаёт дату объектом; в поле формы она должна попасть строкой
    // ГГГГ-ММ-ДД, иначе input type=date её не покажет и дата потеряется.
    parseEnrollmentImportAction.mockResolvedValue({
      ok: true,
      items: [
        importedItem({
          birthDate: new Date('1990-01-15T00:00:00.000Z'),
          position: 'Инженер',
          snils: '11223344595',
        }),
      ],
      errors: [],
      warnings: [],
    });
    goToStep2();
    uploadFile();
    await waitFor(() => expect(screen.getByDisplayValue('Мария Кузнецова')).toBeTruthy());
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      '1990-01-15'
    );
    expect(screen.getByDisplayValue('Инженер')).toBeTruthy();
    expect(screen.getByDisplayValue('11223344595')).toBeTruthy();
  });

  it('ok:false → список ошибок в role=alert, строки не добавляются', async () => {
    parseEnrollmentImportAction.mockResolvedValue({
      ok: false,
      errors: ['В первой строке файла не найдены колонки «ФИО» и «Email». Скачайте шаблон.'],
    });
    goToStep2();
    uploadFile();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('не найдены колонки «ФИО» и «Email»');
    expect(screen.getByText('Строк в заявке: 0')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('ok:true с errors и warnings: валидные строки добавлены, оба списка на экране', async () => {
    parseEnrollmentImportAction.mockResolvedValue({
      ok: true,
      items: [importedItem()],
      errors: ['Строка 3: некорректный email'],
      warnings: ['Строка 4: дубликат внутри файла — пропущена'],
    });
    goToStep2();
    uploadFile();

    await waitFor(() => expect(screen.getByText('Строк в заявке: 1')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Строка 3: некорректный email');
    expect(screen.getByRole('status').textContent).toContain(
      'Строка 4: дубликат внутри файла — пропущена'
    );
    expect(toastSuccess).toHaveBeenCalledWith('Импортировано строк: 1');
  });

  it('У-35: тот же человек с ТЕМ ЖЕ обучением — пропуск, с другим — добавляется', async () => {
    parseEnrollmentImportAction.mockResolvedValue({
      ok: true,
      items: [
        importedItem({ fullName: 'Мария Дубль', email: 'maria@example.com', directionId: 'd1' }),
        importedItem({
          fullName: 'Мария Кузнецова',
          email: 'maria@example.com',
          directionId: 'd2',
        }),
      ],
      errors: [],
      warnings: [],
    });
    goToStep2();
    // Набираем строку вручную: тот же email и то же обучение d1.
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить слушателя вручную' }));
    fireEvent.change(screen.getByPlaceholderText('Email *'), {
      target: { value: 'maria@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Обучение для строки 1'), { target: { value: 'd1' } });
    expect(screen.getByText('Строк в заявке: 1')).toBeTruthy();

    uploadFile();

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(
      'Мария Дубль (maria@example.com): это обучение уже в заявке — пропущен'
    );
    // Первая строка — повтор пары, вторая (другое обучение) добавилась.
    expect(screen.getByText('Строк в заявке: 2')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith('Импортировано строк: 1');
  });

  it('исключение в action → «Не удалось обработать файл…» в role=alert', async () => {
    parseEnrollmentImportAction.mockRejectedValue(new Error('boom'));
    goToStep2();
    uploadFile();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось обработать файл — попробуйте ещё раз');
    expect(screen.getByText('Строк в заявке: 0')).toBeTruthy();
  });
});
