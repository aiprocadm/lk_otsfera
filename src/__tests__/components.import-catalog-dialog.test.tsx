// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { ImportCatalogDialog } from '@/components/settings/import-catalog-dialog';

/**
 * Диалог «Импорт из Excel» каталога (`У-137`, этап 5 PR-2).
 *
 * Проверяем то, ради чего диалог двухшаговый: между «проверить файл» и
 * «импортировать» файл **не перечитывается** — на запись уходят ровно те
 * разобранные строки, что человек увидел в сводке. Плюс ошибки файла в
 * error-регионе `Dialog` и блокировка записи, когда записывать нечего.
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
vi.mock('@/server-actions/admin/catalogImport', () => ({
  previewCatalogImportAction: previewAction,
  commitCatalogImportAction: commitAction,
}));

const h = React.createElement;
const COMPANY = 'co-1';
const ROWS = [
  { line: 2, input: { name: 'Обучение по охране труда', code: 'OT-101', price: '12500.00' } },
];

function renderDialog(cabinet: 'admin' | 'leader' = 'admin') {
  render(h(ImportCatalogDialog, { cabinet, companyId: COMPANY }));
}

function dialog() {
  const el = document.querySelector('dialog[open]');
  if (!el) throw new Error('диалог закрыт');
  return within(el as HTMLElement);
}

function openDialog() {
  fireEvent.click(screen.getByTestId('import-catalog-open'));
}

/** Отправляет форму предпросмотра — React 19 form action ловится сабмитом. */
function submitPreview() {
  const form = dialog().getByTestId('import-catalog-form') as HTMLFormElement;
  fireEvent.submit(form);
}

function okPreview(over: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    rows: ROWS,
    willCreate: 1,
    willUpdate: 0,
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
  commitAction.mockResolvedValue({ ok: true, created: 1, updated: 0 });
});

afterEach(() => cleanup());

describe('ImportCatalogDialog — первый шаг «проверить файл»', () => {
  it('кнопка «Импорт из Excel» открывает диалог с формой файла', () => {
    renderDialog();
    expect(document.querySelector('dialog[open]')).toBeNull();

    openDialog();
    expect(dialog().getByTestId('import-catalog-file')).toBeTruthy();
    expect(dialog().getByRole('button', { name: 'Проверить файл' })).toBeTruthy();
  });

  it('предпросмотр зовётся с кабинетом и FormData: файл + companyId подставлены', async () => {
    renderDialog('leader');
    openDialog();
    submitPreview();

    await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(1));
    expect(previewAction.mock.calls[0][0]).toBe('leader');
    const fd = previewAction.mock.calls[0][1] as FormData;
    expect(fd).toBeInstanceOf(FormData);
    // Компанию человек не вводит — она приходит пропсом со страницы.
    expect(fd.get('companyId')).toBe(COMPANY);
    // Файл едет в той же FormData (имя поля читает previewCatalogImportAction).
    expect(fd.has('file')).toBe(true);
  });

  it('разбитый файл показывает ошибки в error-регионе, а форма остаётся', async () => {
    previewAction.mockResolvedValue({ ok: false, errors: ['Строка 2: не указан артикул'] });
    renderDialog();
    openDialog();
    submitPreview();

    expect(await dialog().findByTestId('import-catalog-errors')).toBeTruthy();
    expect(dialog().getByText('Строка 2: не указан артикул')).toBeTruthy();
    // Предпросмотра нет — записывать нечего, файл выбирают заново.
    expect(dialog().queryByTestId('import-catalog-preview')).toBeNull();
    expect(dialog().getByTestId('import-catalog-form')).toBeTruthy();
  });

  it('длинный список ошибок обрезается и честно говорит, сколько скрыто', async () => {
    const errors = Array.from({ length: 25 }, (_, i) => `Строка ${i + 2}: не указан артикул`);
    previewAction.mockResolvedValue({ ok: false, errors });
    renderDialog();
    openDialog();
    submitPreview();

    expect(await dialog().findByText('…и ещё 5')).toBeTruthy();
    const block = (await dialog().findByTestId('import-catalog-errors')) as HTMLElement;
    expect(within(block).getAllByRole('listitem')).toHaveLength(20);
  });

  it('пока файл читается — кнопка занята и заблокирована', async () => {
    let release: (v: unknown) => void = () => {};
    previewAction.mockImplementation(() => new Promise((r) => (release = r)));
    renderDialog();
    openDialog();
    submitPreview();

    const btn = (await dialog().findByRole('button', { name: 'Читаю файл…' })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    release(okPreview());
    await dialog().findByTestId('import-catalog-preview');
  });
});

describe('ImportCatalogDialog — второй шаг «что произойдёт»', () => {
  it('сводка: будет создано · обновлено · строк с ошибками, форма файла ушла', async () => {
    previewAction.mockResolvedValue(
      okPreview({ willCreate: 2, willUpdate: 1, errors: ['Строка 5: цена не число'] })
    );
    renderDialog();
    openDialog();
    submitPreview();

    const preview = (await dialog().findByTestId('import-catalog-preview')) as HTMLElement;
    expect(preview.textContent).toContain('Будет создано: 2');
    expect(preview.textContent).toContain('обновлено: 1');
    expect(preview.textContent).toContain('строк с ошибками: 1');
    // Сам список ошибок тоже показан — в error-регионе диалога.
    expect(dialog().getByText('Строка 5: цена не число')).toBeTruthy();
    // Форма выбора файла ушла: подтверждается уже прочитанное.
    expect(dialog().queryByTestId('import-catalog-form')).toBeNull();
  });

  it('когда записывать нечего — кнопка заблокирована и объяснение на месте', async () => {
    previewAction.mockResolvedValue(
      okPreview({ willCreate: 0, willUpdate: 0, rows: [], errors: ['Строка 2: пустое название'] })
    );
    renderDialog();
    openDialog();
    submitPreview();

    const commit = (await dialog().findByTestId('import-catalog-commit')) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    expect(dialog().getByTestId('import-catalog-nothing').textContent).toContain(
      'исправьте ошибки'
    );
  });

  it('«Назад» возвращает к выбору файла, не записав ничего', async () => {
    previewAction.mockResolvedValue(okPreview({ errors: ['Строка 9: лишняя колонка'] }));
    renderDialog();
    openDialog();
    submitPreview();
    await dialog().findByTestId('import-catalog-preview');

    fireEvent.click(dialog().getByRole('button', { name: 'Назад' }));

    expect(dialog().getByTestId('import-catalog-form')).toBeTruthy();
    expect(dialog().queryByTestId('import-catalog-preview')).toBeNull();
    // Ошибки прошлого файла не висят над новой попыткой.
    expect(dialog().queryByTestId('import-catalog-errors')).toBeNull();
    expect(commitAction).not.toHaveBeenCalled();
  });
});

describe('ImportCatalogDialog — запись', () => {
  it('записывает ровно те строки, что показал предпросмотр', async () => {
    renderDialog();
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-catalog-commit'));

    await waitFor(() => expect(commitAction).toHaveBeenCalledTimes(1));
    // Второго чтения файла нет: в сервис уходят разобранные строки.
    expect(commitAction).toHaveBeenCalledWith('admin', COMPANY, ROWS);
    expect(previewAction).toHaveBeenCalledTimes(1);
  });

  it('после успеха сообщает итоги, закрывается и обновляет список', async () => {
    commitAction.mockResolvedValue({ ok: true, created: 3, updated: 2 });
    renderDialog();
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-catalog-commit'));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Каталог обновлён: создано 3 · обновлено 2')
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    // Закрытие идёт эффектом (декларативный `open` → императивный `close()`),
    // и под нагрузкой полного прогона оно отстаёт от тоста — ждём схождения,
    // а не проверяем в тот же тик (иначе тест мигает).
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull());
  });

  it('отказ сервиса показывается в диалоге, а он остаётся открытым', async () => {
    commitAction.mockResolvedValue({ ok: false, error: 'Нет прав изменять каталог этой компании.' });
    renderDialog();
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-catalog-commit'));

    expect(await dialog().findByText('Нет прав изменять каталог этой компании.')).toBeTruthy();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('во время записи диалог не закрывается — иначе непонятно, записалось ли', async () => {
    let release: (v: unknown) => void = () => {};
    commitAction.mockImplementation(() => new Promise((r) => (release = r)));
    renderDialog();
    openDialog();
    submitPreview();
    fireEvent.click(await dialog().findByTestId('import-catalog-commit'));

    await waitFor(() =>
      expect(dialog().getByRole('button', { name: 'Записываю…' })).toBeTruthy()
    );
    fireEvent.keyDown(document.querySelector('dialog[open]') as HTMLElement, { key: 'Escape' });
    expect(document.querySelector('dialog[open]')).not.toBeNull();

    release({ ok: true, created: 1, updated: 0 });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
