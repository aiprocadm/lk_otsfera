// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { ImportStudentsDialog } from '@/components/students/import-students-dialog';

/**
 * Диалог «Загрузить списком» (`У-27`, `У-28`, этап 5).
 *
 * Компонент отгрузили без единого теста — долг гейта покрытия. Проверяем то,
 * ради чего он двухшаговый: между «проверить файл» и «добавить» файл **не
 * перечитывается**, и записывается ровно то, что человек увидел на экране.
 * Плюс все ветки предупреждений — именно они объясняют человеку, почему
 * строк добавится меньше, чем он положил в файл.
 */
const { push, refresh, previewAction, commitAction, toastSuccess } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  previewAction: vi.fn(),
  commitAction: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));
vi.mock('@/server-actions/students-import', () => ({
  previewStudentsAction: previewAction,
  commitStudentsImportAction: commitAction,
}));

const ORG = 'org-1';

function dialog() {
  const el = document.querySelector('dialog[open]');
  if (!el) throw new Error('диалог закрыт');
  return within(el as HTMLElement);
}

function openDialog() {
  fireEvent.click(screen.getByTestId('import-students-open'));
}

/** Отправляет форму предпросмотра — React 19 form action ловится сабмитом. */
function submitPreview() {
  const form = dialog().getByTestId('import-students-form') as HTMLFormElement;
  fireEvent.submit(form);
}

function okPreview(over: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    rows: [{ name: 'Иванов Иван', line: 2 }],
    willCreate: 1,
    duplicates: [],
    errors: [],
    ...over,
  };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  previewAction.mockResolvedValue(okPreview());
  commitAction.mockResolvedValue({ ok: true, created: 1, skipped: 0 });
});

afterEach(() => cleanup());

describe('ImportStudentsDialog — первый шаг «проверить файл»', () => {
  it('кнопка открывает диалог, и в нём есть ссылка на шаблон', () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    expect(document.querySelector('dialog[open]')).toBeNull();

    openDialog();
    const link = dialog().getByTestId('import-students-template');
    expect(link.getAttribute('href')).toBe('/api/students/import-template');
  });

  it('объясняет, что обязательна только ФИО', () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    expect(dialog().getByText(/Обязательна только колонка «ФИО»/)).toBeTruthy();
  });

  it('организация подставляется сама — человек её не вводит', async () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(1));
    const fd = previewAction.mock.calls[0][0] as FormData;
    expect(fd.get('organizationId')).toBe(ORG);
  });

  it('разбитый файл показывает список ошибок, а форма остаётся на месте', async () => {
    previewAction.mockResolvedValue({ ok: false, errors: ['Строка 2: не указана ФИО'] });
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    expect(await dialog().findByRole('alert')).toBeTruthy();
    expect(dialog().getByText('Строка 2: не указана ФИО')).toBeTruthy();
    // Предпросмотра нет — записывать нечего.
    expect(dialog().queryByTestId('import-students-preview')).toBeNull();
    expect(dialog().getByTestId('import-students-form')).toBeTruthy();
  });

  it('длинный список ошибок обрезается и честно говорит, сколько скрыто', async () => {
    const errors = Array.from({ length: 25 }, (_, i) => `Строка ${i + 2}: не указана ФИО`);
    previewAction.mockResolvedValue({ ok: false, errors });
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    expect(await dialog().findByText('…и ещё 5')).toBeTruthy();
    // Скоуп по заголовку блока: у самого диалога есть свой всегда-смонтированный
    // aria-live регион с той же ролью (примитив `Dialog`, §9).
    const block = dialog().getByText('Что не так в файле:').parentElement as HTMLElement;
    expect(within(block).getAllByRole('listitem')).toHaveLength(20);
  });
});

describe('ImportStudentsDialog — второй шаг «что произойдёт»', () => {
  it('показывает, сколько добавится, и предлагает записать', async () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    const commit = await dialog().findByTestId('import-students-commit');
    expect(commit.textContent).toBe('Добавить 1');
    expect(dialog().getByText('Что произойдёт')).toBeTruthy();
    // Форма выбора файла ушла: подтверждается уже прочитанное.
    expect(dialog().queryByTestId('import-students-form')).toBeNull();
  });

  it('дубликаты названы поимённо — видно, почему строк добавится меньше', async () => {
    previewAction.mockResolvedValue(
      okPreview({
        willCreate: 1,
        duplicates: [{ line: 3, name: 'Петров Пётр', existingName: 'Петров П. П.' }],
      })
    );
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    expect(
      await dialog().findByText(/Строка 3: Петров Пётр → уже есть «Петров П. П.»/)
    ).toBeTruthy();
  });

  it('длинный список дубликатов обрезается до двадцати', async () => {
    const duplicates = Array.from({ length: 22 }, (_, i) => ({
      line: i + 2,
      name: `Сотрудник ${i}`,
      existingName: `Существующий ${i}`,
    }));
    previewAction.mockResolvedValue(okPreview({ duplicates }));
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    await dialog().findByTestId('import-students-preview');
    const list = dialog().getByText(/Эти строки пропустим/).parentElement as HTMLElement;
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
  });

  it('строки с ошибками посчитаны отдельно от дубликатов', async () => {
    previewAction.mockResolvedValue(okPreview({ errors: ['Строка 5: неверная дата'] }));
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    expect(await dialog().findByText(/строк с ошибками:/)).toBeTruthy();
    // Тот же список ошибок показан подробно.
    expect(dialog().getByText('Строка 5: неверная дата')).toBeTruthy();
  });

  it('когда добавлять нечего — кнопка записи заблокирована', async () => {
    previewAction.mockResolvedValue(
      okPreview({
        willCreate: 0,
        rows: [],
        duplicates: [{ line: 2, name: 'Иванов', existingName: 'Иванов И.' }],
      })
    );
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();

    const commit = (await dialog().findByTestId('import-students-commit')) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });

  it('«Выбрать другой файл» возвращает к форме, не записав ничего', async () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    await dialog().findByTestId('import-students-preview');

    fireEvent.click(dialog().getByRole('button', { name: 'Выбрать другой файл' }));

    expect(dialog().getByTestId('import-students-form')).toBeTruthy();
    expect(commitAction).not.toHaveBeenCalled();
  });
});

describe('ImportStudentsDialog — запись', () => {
  it('записывает ровно те строки, что показал предпросмотр', async () => {
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-students-commit'));

    await waitFor(() => expect(commitAction).toHaveBeenCalledTimes(1));
    // Второго чтения файла нет: в сервис уходят разобранные строки.
    expect(commitAction).toHaveBeenCalledWith(ORG, [{ name: 'Иванов Иван', line: 2 }]);
    expect(previewAction).toHaveBeenCalledTimes(1);
  });

  it('после успеха сообщает результат, закрывается и обновляет список', async () => {
    commitAction.mockResolvedValue({ ok: true, created: 3, skipped: 0 });
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-students-commit'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Добавлено сотрудников: 3'));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('пропущенные дубликаты попадают в сообщение — иначе цифра выглядит ошибкой', async () => {
    commitAction.mockResolvedValue({ ok: true, created: 2, skipped: 1 });
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-students-commit'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Добавлено сотрудников: 2, пропущено дубликатов: 1')
    );
  });

  it('отказ сервиса показывается в диалоге, а он остаётся открытым', async () => {
    commitAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-students-commit'));

    expect(await dialog().findByText('forbidden')).toBeTruthy();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('во время записи диалог не закрывается — иначе непонятно, записалось ли', async () => {
    let release: (v: unknown) => void = () => {};
    commitAction.mockImplementation(() => new Promise((r) => (release = r)));
    render(<ImportStudentsDialog organizationId={ORG} />);
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-students-commit'));

    await waitFor(() => expect(commitAction).toHaveBeenCalled());
    fireEvent.keyDown(document.querySelector('dialog[open]') as HTMLElement, { key: 'Escape' });
    expect(document.querySelector('dialog[open]')).not.toBeNull();

    release({ ok: true, created: 1, skipped: 0 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
