// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BatchSummary } from '@/lib/services/oneCSync/record-batch';

const { previewImportAction, commitImportAction } = vi.hoisted(() => ({
  previewImportAction: vi.fn(),
  commitImportAction: vi.fn(),
}));
vi.mock('@/server-actions/import', () => ({ previewImportAction, commitImportAction }));

import { ImportForm } from '@/components/import/import-form';

function emptySummary(overrides: Partial<BatchSummary> = {}): BatchSummary {
  return {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    failed: 0,
    skips: [],
    invalids: [],
    failures: [],
    ...overrides,
  };
}

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ImportForm (interactive, jsdom)', () => {
  beforeEach(() => {
    previewImportAction.mockReset();
    commitImportAction.mockReset();
  });

  it('preview submit button is disabled with no file, enabled once a file is chosen', () => {
    render(React.createElement(ImportForm));
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    const button = screen.getByTestId('import-preview-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    pickFile(input, new File(['x'], 'orders.xlsx'));
    expect(button.disabled).toBe(false);
  });

  it('submitting with no file selected is a no-op (defensive guard in handlePreview)', () => {
    render(React.createElement(ImportForm));
    const form = screen.getByTestId('import-file-input').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(previewImportAction).not.toHaveBeenCalled();
  });

  it('preview success: shows the plan section with per-entity counts and no error alert', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({ pulled: 5, created: 3, updated: 2 }),
        payments: emptySummary({ pulled: 4, created: 4 }),
      },
    });
    render(React.createElement(ImportForm));
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'orders.xlsx'));
    fireEvent.click(screen.getByTestId('import-preview-button'));

    expect(await screen.findByTestId('import-plan')).toBeTruthy();
    expect(screen.getByTestId('count-orders-created').textContent).toBe('3');
    expect(screen.getByTestId('count-payments-created').textContent).toBe('4');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('import-commit-button')).toBeTruthy();
  });

  it('preview shows a loading label while pending, then resolves', async () => {
    let resolvePreview: (v: unknown) => void = () => {};
    previewImportAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        })
    );
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));

    expect(await screen.findByText('Загрузка…')).toBeTruthy();
    resolvePreview({ ok: true, report: { orders: emptySummary(), payments: emptySummary() } });
    await waitFor(() => expect(screen.getByTestId('import-plan')).toBeTruthy());
  });

  it('preview failure (forbidden): shows the mapped error message in an alert, no plan section', async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Недостаточно прав');
    expect(screen.queryByTestId('import-plan')).toBeNull();
  });

  it('preview failure (invalid_file / empty / parse_failed) map to their Russian messages', async () => {
    for (const [code, expected] of [
      ['invalid_file', 'Выберите файл .xls или .xlsx (не более 25 МБ)'],
      ['empty', 'Файл пуст или нет валидных строк'],
      ['parse_failed', 'Не удалось разобрать файл'],
    ] as const) {
      previewImportAction.mockReset();
      previewImportAction.mockResolvedValue({ ok: false, error: code });
      const { unmount } = render(React.createElement(ImportForm));
      pickFile(
        screen.getByTestId('import-file-input') as HTMLInputElement,
        new File(['x'], 'a.xlsx')
      );
      fireEvent.click(screen.getByTestId('import-preview-button'));
      expect(await screen.findByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it('preview failure with an unmapped code falls back to "Ошибка: <code>"', async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));
    expect(await screen.findByText('Ошибка: weird_code')).toBeTruthy();
  });

  it('picking a new file after a preview resets both preview and commit results', async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(ImportForm));
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'a.xlsx'));
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByRole('alert');

    pickFile(input, new File(['x'], 'b.xlsx'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ReasonsTable renders skip and invalid rows with externalId fallback to em dash', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({
          pulled: 2,
          skipped: 1,
          invalid: 1,
          skips: [{ externalId: 'EXT-1', reason: 'дубликат' }],
          invalids: [{ externalId: null, issue: 'нет даты' }],
        }),
        payments: emptySummary(),
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));

    await screen.findByTestId('import-plan');
    expect(screen.getByText('EXT-1')).toBeTruthy();
    expect(screen.getByText('дубликат')).toBeTruthy();
    expect(screen.getByText('нет даты')).toBeTruthy();
    expect(screen.getByText('Заказы — причины пропуска / ошибок')).toBeTruthy();
  });

  it('ReasonsTable renders nothing when there are no skips/invalids (rows.length===0 branch)', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary({ pulled: 1, created: 1 }), payments: emptySummary() },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));

    await screen.findByTestId('import-plan');
    expect(screen.queryByText('причины пропуска / ошибок', { exact: false })).toBeNull();
  });

  it('EntitySummary shows the "Ошибок" row only when failed > 0', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({
          pulled: 1,
          failed: 1,
          failures: [{ externalId: 'X', error: 'boom' }],
        }),
        payments: emptySummary(),
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));

    await screen.findByTestId('import-plan');
    expect(screen.getByText('Ошибок')).toBeTruthy();
  });

  it('commit success: shows the success banner + final summaries, hides the commit button', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({ pulled: 2, created: 2 }),
        payments: emptySummary({ pulled: 1, created: 1 }),
      },
    });
    commitImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({ pulled: 2, created: 2 }),
        payments: emptySummary({ pulled: 1, created: 1 }),
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByTestId('import-commit-button');

    fireEvent.click(screen.getByTestId('import-commit-button'));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('Импорт выполнен')).toBeTruthy();
    expect(screen.queryByTestId('import-commit-button')).toBeNull();
  });

  it('commit shows a loading label while pending', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary(), payments: emptySummary() },
    });
    let resolveCommit: (v: unknown) => void = () => {};
    commitImportAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommit = resolve;
        })
    );
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByTestId('import-commit-button');

    fireEvent.click(screen.getByTestId('import-commit-button'));
    expect(await screen.findByText('Импорт…')).toBeTruthy();
    resolveCommit({ ok: true, report: { orders: emptySummary(), payments: emptySummary() } });
    await waitFor(() => expect(screen.getByText('Импорт выполнен')).toBeTruthy());
  });

  it('commit failure: shows the mapped error alert, no success banner', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary(), payments: emptySummary() },
    });
    commitImportAction.mockResolvedValue({ ok: false, error: 'parse_failed' });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByTestId('import-commit-button');

    fireEvent.click(screen.getByTestId('import-commit-button'));
    expect(await screen.findByText('Не удалось разобрать файл')).toBeTruthy();
    expect(screen.queryByText('Импорт выполнен')).toBeNull();
  });

  it('handleCommit is a no-op when there is no file (defensive guard, unreachable via UI but exercised for completeness)', async () => {
    // The commit button only renders after a successful preview, which itself
    // requires a file — so in practice this guard is unreachable via user
    // interaction alone. We still exercise it directly through the DOM:
    // clearing files on the (still-mounted) input before invoking commit.
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary(), payments: emptySummary() },
    });
    render(React.createElement(ImportForm));
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'a.xlsx'));
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await screen.findByTestId('import-commit-button');

    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.click(screen.getByTestId('import-commit-button'));
    expect(commitImportAction).not.toHaveBeenCalled();
  });
});

/**
 * Блок «Что увидела система в файле» (Т-3) — ради него этап и делается:
 * он обязан появляться и когда файл разобрался, и когда не распозналось ничего.
 */
describe('ImportForm — «Что увидела система в файле»', () => {
  const DIAGNOSTICS = {
    sheetsFound: ['Контрагенты', 'Реализация товаров и услуг'],
    sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
    unmatchedHeaders: { Контрагенты: ['КПП', 'Адрес'] },
  };

  beforeEach(() => {
    previewImportAction.mockReset();
    commitImportAction.mockReset();
  });

  it('файл не распознан: показаны найденные листы, ожидаемые и чужие заголовки', async () => {
    previewImportAction.mockResolvedValue({
      ok: false,
      error: 'empty',
      diagnostics: DIAGNOSTICS,
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const panel = await screen.findByTestId('import-diagnostics');
    expect(panel.textContent).toContain('Реализация товаров и услуг');
    expect(panel.textContent).toContain('Поступления');
    expect(panel.textContent).toContain('«КПП»');
    expect(panel.textContent).toContain('«Адрес»');
    // Сообщение об ошибке при этом никуда не делось.
    expect(screen.getByRole('alert').textContent).toContain('Файл пуст');
  });

  it('файл разобран: блок тоже виден, чужих заголовков нет — строку не рисуем', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: {
        orders: emptySummary({ pulled: 1, created: 1 }),
        payments: emptySummary(),
        diagnostics: { ...DIAGNOSTICS, unmatchedHeaders: { Контрагенты: [] } },
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const panel = await screen.findByTestId('import-diagnostics');
    expect(panel.textContent).toContain('Контрагенты');
    expect(panel.textContent).not.toContain('Не распознаны заголовки');
  });

  it('листов в книге нет вовсе — вместо пустоты прочерк', async () => {
    previewImportAction.mockResolvedValue({
      ok: false,
      error: 'empty',
      diagnostics: { ...DIAGNOSTICS, sheetsFound: [], unmatchedHeaders: {} },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    expect((await screen.findByTestId('diagnostics-sheets-found')).textContent).toBe('—');
  });

  it('ответ без диагностики (старый сервер) блок не рисует и не роняет форму', async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByTestId('import-diagnostics')).toBeNull();
  });
});

/**
 * Т-4/Т-6: форма перестала молчать. Раньше при отклонённом промисе состояние
 * не менялось — кнопка отщёлкивала, на экране ноль изменений; а файл больше
 * общего предела Next обрезал ещё до входа в наш код.
 */
describe('ImportForm — сбой и слишком большой файл', () => {
  beforeEach(() => {
    previewImportAction.mockReset();
    commitImportAction.mockReset();
  });

  it('запрос не дошёл до сервера: красный блок вместо пустого экрана', async () => {
    previewImportAction.mockRejectedValue(new Error('Body exceeded 25mb limit'));
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Сервер не принял файл');
    expect(alert.textContent).toContain('25 МБ');
    // Кнопка снова активна — попытку можно повторить.
    const button = screen.getByTestId('import-preview-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Загрузить и проверить');
  });

  it('файл больше предела: запрос НЕ уходит, показан его размер', async () => {
    render(React.createElement(ImportForm));
    const big = new File(['x'], 'big.xlsx');
    Object.defineProperty(big, 'size', { value: 34 * 1024 * 1024 });
    pickFile(screen.getByTestId('import-file-input') as HTMLInputElement, big);
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('больше предела в 25 МБ');
    expect(alert.textContent).toContain('34,0 МБ');
    expect(previewImportAction).not.toHaveBeenCalled();
  });

  it('файл в пределах отправляется как обычно', async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: 'empty' });
    render(React.createElement(ImportForm));
    const ok = new File(['x'], 'ok.xlsx');
    Object.defineProperty(ok, 'size', { value: 5 * 1024 * 1024 });
    pickFile(screen.getByTestId('import-file-input') as HTMLInputElement, ok);
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    await waitFor(() => expect(previewImportAction).toHaveBeenCalled());
  });

  it('сбой на подтверждении импорта тоже виден', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary({ pulled: 1 }), payments: emptySummary() },
    });
    commitImportAction.mockRejectedValue(new Error('network down'));
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);
    fireEvent.click(await screen.findByTestId('import-commit-button'));

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((el) => el.textContent?.includes('Сервер не принял файл'))
      ).toBe(true)
    );
  });

  it('слишком большой файл не уходит и на подтверждении', async () => {
    previewImportAction.mockResolvedValue({
      ok: true,
      report: { orders: emptySummary({ pulled: 1 }), payments: emptySummary() },
    });
    render(React.createElement(ImportForm));
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'orders.xlsx'));
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    const commit = await screen.findByTestId('import-commit-button');

    // Пользователь подменил файл на большой между проверкой и подтверждением.
    const big = new File(['x'], 'big.xlsx');
    Object.defineProperty(big, 'size', { value: 40 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    fireEvent.click(commit);

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((el) => el.textContent?.includes('больше предела'))
      ).toBe(true)
    );
    expect(commitImportAction).not.toHaveBeenCalled();
  });
});

/** Этап 3: панель диагностики показывает недостающие колонки, дубли листов и формат. */
describe('ImportForm — диагностика этапа 3', () => {
  beforeEach(() => {
    previewImportAction.mockReset();
    commitImportAction.mockReset();
  });

  it('columns_not_recognized: перечислены недостающие колонки по листам', async () => {
    previewImportAction.mockResolvedValue({
      ok: false,
      error: 'columns_not_recognized',
      diagnostics: {
        sheetsFound: ['Поступления'],
        sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
        unmatchedHeaders: { Поступления: [] },
        missingColumns: { Поступления: ['Сумма', 'Дата'] },
        duplicateSheets: {},
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const missing = await screen.findByTestId('diagnostics-missing-columns');
    expect(missing.textContent).toContain('«Сумма»');
    expect(missing.textContent).toContain('«Дата»');
    expect(screen.getByRole('alert').textContent).toContain('обязательных колонок');
  });

  it('дубли листов и замечание о формате видны', async () => {
    previewImportAction.mockResolvedValue({
      ok: false,
      error: 'empty',
      diagnostics: {
        sheetsFound: ['Контрагенты', 'Контрагенты (копия)'],
        sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
        unmatchedHeaders: { Контрагенты: [] },
        missingColumns: {},
        duplicateSheets: { Контрагенты: ['Контрагенты (копия)'] },
        formatNote: 'Файл называется «в.xlsx», но внутри — старый формат .xls.',
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'в.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    expect((await screen.findByTestId('diagnostics-duplicate-sheets')).textContent).toContain(
      'Контрагенты (копия)'
    );
    expect(screen.getByTestId('diagnostics-format-note').textContent).toContain(
      'старый формат .xls'
    );
  });

  it('диагностика этапа 1 (без новых полей) не роняет панель', async () => {
    previewImportAction.mockResolvedValue({
      ok: false,
      error: 'empty',
      diagnostics: {
        sheetsFound: ['Контрагенты'],
        sheetsExpected: ['Контрагенты', 'Реализации', 'Поступления'],
        unmatchedHeaders: { Контрагенты: ['КПП'] },
      },
    });
    render(React.createElement(ImportForm));
    pickFile(
      screen.getByTestId('import-file-input') as HTMLInputElement,
      new File(['x'], 'orders.xlsx')
    );
    fireEvent.submit(screen.getByTestId('import-file-input').closest('form') as HTMLFormElement);

    const panel = await screen.findByTestId('import-diagnostics');
    expect(panel.textContent).toContain('«КПП»');
    expect(screen.queryByTestId('diagnostics-missing-columns')).toBeNull();
    expect(screen.queryByTestId('diagnostics-duplicate-sheets')).toBeNull();
  });
});
