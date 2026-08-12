// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { previewPaymentImportAction, commitPaymentImportAction } = vi.hoisted(() => ({
  previewPaymentImportAction: vi.fn(),
  commitPaymentImportAction: vi.fn(),
}));
vi.mock('@/server-actions/payment-import', () => ({
  previewPaymentImportAction,
  commitPaymentImportAction,
}));

import { PaymentImportForm } from '@/components/import/payment-import-form';

type Counts = {
  totalRows: number;
  imported: number;
  refunds: number;
  queued: number;
  excluded: number;
  excludedByReason: Record<string, number>;
  /** Почему строки ушли в очередь (добавлено 11.08.2026). */
  queuedByReason?: Record<string, number>;
  parseErrors: number;
};

function emptyCounts(overrides: Partial<Counts> = {}): Counts {
  return {
    totalRows: 0,
    imported: 0,
    refunds: 0,
    queued: 0,
    excluded: 0,
    excludedByReason: {},
    parseErrors: 0,
    ...overrides,
  };
}

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('PaymentImportForm (interactive, jsdom)', () => {
  beforeEach(() => {
    previewPaymentImportAction.mockReset();
    commitPaymentImportAction.mockReset();
  });

  it('preview button disabled with no file, enabled once chosen', () => {
    render(React.createElement(PaymentImportForm));
    const input = screen.getByTestId('payment-import-file-input') as HTMLInputElement;
    const button = screen.getByTestId('payment-import-preview-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    pickFile(input, new File(['x'], 'card51.xlsx'));
    expect(button.disabled).toBe(false);
  });

  it('submitting with no file selected is a no-op', () => {
    render(React.createElement(PaymentImportForm));
    const form = screen.getByTestId('payment-import-file-input').closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(previewPaymentImportAction).not.toHaveBeenCalled();
  });

  it('preview success shows the plan with counts, no error alert', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({ totalRows: 10, imported: 7, refunds: 1, queued: 2, excluded: 1 }),
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    expect(await screen.findByTestId('payment-import-plan')).toBeTruthy();
    expect(screen.getByTestId('count-imported').textContent).toBe('7');
    expect(screen.getByTestId('count-queued').textContent).toBe('2');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('payment-import-commit-button')).toBeTruthy();
  });

  it('У-52: новые контрагенты показаны списком «название + ИНН» ДО применения', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({ totalRows: 5, imported: 2, queued: 3 }),
        newCounterparties: [
          { name: 'ООО «Альфа»', inn: '7707083893', rows: 2 },
          { name: '', inn: '7736207543', rows: 1 },
        ],
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    const card = await screen.findByTestId('payment-import-new-counterparties');
    expect(card.textContent).toContain('Новых контрагентов в файле: 2');
    expect(card.textContent).toContain('ООО «Альфа»');
    expect(card.textContent).toContain('7707083893');
    // Контрагент без названия не превращается в пустую строку списка.
    expect(card.textContent).toContain('без названия');
    // Несколько строк одного контрагента — видно, что это не один платёж.
    expect(card.textContent).toContain('строк: 2');
  });

  it('У-52: когда новых контрагентов нет — блока нет вовсе, а не «0»', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: { counts: emptyCounts({ totalRows: 2, imported: 2 }), newCounterparties: [] },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    expect(await screen.findByTestId('payment-import-plan')).toBeTruthy();
    expect(screen.queryByTestId('payment-import-new-counterparties')).toBeNull();
  });

  it('У-58: блок «Что система увидела в файле» объясняет непрочитанные строки', async () => {
    // Ровно жалоба пользователя: строки есть, к импорту ноль. Экран обязан
    // сказать ПОЧЕМУ, а не показать голое число ошибок.
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({ totalRows: 327, excluded: 198, parseErrors: 129 }),
        diagnostics: {
          columnSource: 'headers',
          headerRow: 4,
          matchedColumns: { document: 1, debit: 4 },
          startMarkerFound: true,
          rowsScanned: 327,
          // Код без русской подписи (например добавленный позже на сервере)
          // показывается как есть — экран не должен молчать.
          parseErrorsByReason: { no_doc_number: 129, no_such_reason: 1 },
          samples: [
            {
              rowNumber: 12,
              reasons: ['no_doc_number'],
              document: 'Поступление на расчетный счет б/н',
              corr: '62.01',
            },
            // Строка, где колонка «Документ» пуста и корр-счёта нет; причина —
            // с кодом, которого нет в словаре подписей.
            { rowNumber: 13, reasons: ['no_amount', 'no_such_reason'], document: '', corr: '' },
          ],
          notes: ['Строка «Сальдо на начало» не найдена — таблица прочитана от заголовков.'],
        },
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    const box = await screen.findByTestId('payment-import-diagnostics');
    expect(box.textContent).toContain('найдены по заголовкам (строка 5)');
    expect(box.textContent).toContain('Документ → колонка 2');
    expect(box.textContent).toContain('не найден номер документа');
    expect(box.textContent).toContain('no_such_reason');
    expect(box.textContent).toContain('Строка 12');
    expect(box.textContent).toContain('корр. счёт 62.01');
    expect(box.textContent).toContain('(колонка «Документ» пуста)');
    expect(box.textContent).toContain('Сальдо на начало');
  });

  it('У-58: отказ «файл пуст» тоже показывает, что система увидела', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: false,
      error: 'empty',
      diagnostics: {
        columnSource: 'fallback',
        headerRow: null,
        matchedColumns: {},
        startMarkerFound: false,
        rowsScanned: 0,
        parseErrorsByReason: {},
        samples: [],
        notes: ['Похоже, это не карточка счёта 51.'],
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    const box = await screen.findByTestId('payment-import-diagnostics');
    expect(box.textContent).toContain('заголовки не распознаны');
    expect(box.textContent).toContain('не найдена');
    expect(box.textContent).toContain('не карточка счёта 51');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('строки разобраны, но не привязались — объясняем, что это не отказ (жалоба 11.08.2026)', async () => {
    // Ровно случай пользователя: 130 операций прочитаны, ошибок нет, а
    // «К импорту 0» — потому что в системе ещё нет клиентов и заказов из 1С.
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({
          totalRows: 327,
          imported: 0,
          queued: 130,
          excluded: 197,
          queuedByReason: { none: 128, name_fuzzy: 2 },
        }),
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    const hint = await screen.findByTestId('payment-import-nothing-matched');
    expect(hint.textContent).toContain('Загрузка Excel');
    expect(hint.textContent).toContain('не задвоятся');

    const plan = screen.getByTestId('payment-import-plan');
    expect(plan.textContent).toContain('не нашли ни счёт, ни ИНН, ни похожую организацию');
    expect(plan.textContent).toContain('нужно подтвердить вручную');
  });

  it('когда часть строк импортирована — подсказки про «ничего не привязалось» нет', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({
          totalRows: 10,
          imported: 7,
          queued: 3,
          // Незнакомый код причины показывается как есть, а не прячется.
          queuedByReason: { somethingElse: 3 },
        }),
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));

    await screen.findByTestId('payment-import-plan');
    expect(screen.queryByTestId('payment-import-nothing-matched')).toBeNull();
    expect(screen.getByTestId('payment-import-plan').textContent).toContain('somethingElse: 3');
  });

  it('shows a loading label while preview is pending', async () => {
    let resolvePreview: (v: unknown) => void = () => {};
    previewPaymentImportAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        })
    );
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    expect(await screen.findByText('Загрузка…')).toBeTruthy();
    resolvePreview({ ok: true, plan: { counts: emptyCounts() } });
    await waitFor(() => expect(screen.getByTestId('payment-import-plan')).toBeTruthy());
  });

  it('preview failure (forbidden) shows the mapped Russian error, no plan section', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Недостаточно прав');
    expect(screen.queryByTestId('payment-import-plan')).toBeNull();
  });

  it('preview failure codes invalid_file / empty / parse_failed map to their messages', async () => {
    for (const [code, expected] of [
      ['invalid_file', 'Выберите файл .xls или .xlsx (не более 25 МБ)'],
      ['empty', 'Файл пуст или нет строк-операций'],
      ['parse_failed', 'Не удалось разобрать файл'],
    ] as const) {
      previewPaymentImportAction.mockReset();
      previewPaymentImportAction.mockResolvedValue({ ok: false, error: code });
      const { unmount } = render(React.createElement(PaymentImportForm));
      pickFile(
        screen.getByTestId('payment-import-file-input') as HTMLInputElement,
        new File(['x'], 'a.xlsx')
      );
      fireEvent.click(screen.getByTestId('payment-import-preview-button'));
      expect(await screen.findByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it('preview failure with an unmapped code falls back to "Ошибка: <code>"', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    expect(await screen.findByText('Ошибка: mystery')).toBeTruthy();
  });

  it('picking a new file resets preview and commit state', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(PaymentImportForm));
    const input = screen.getByTestId('payment-import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'a.xlsx'));
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByRole('alert');
    pickFile(input, new File(['x'], 'b.xlsx'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the "Ошибок разбора" row only when parseErrors > 0', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: { counts: emptyCounts({ totalRows: 3, parseErrors: 2 }) },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-plan');
    expect(screen.getByText('Ошибок разбора')).toBeTruthy();
  });

  it('does not show the "Ошибок разбора" row when parseErrors is 0', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: { counts: emptyCounts({ totalRows: 3 }) },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-plan');
    expect(screen.queryByText('Ошибок разбора')).toBeNull();
  });

  it('renders excludedByReason list with known-reason RU labels and unknown-code passthrough', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: emptyCounts({
          totalRows: 5,
          excluded: 3,
          excludedByReason: { supplier: 2, unknown_code: 1 },
        }),
      },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-plan');
    expect(screen.getByText('Исключено по причинам:')).toBeTruthy();
    expect(screen.getByText(/Оплаты поставщикам \(60\)/)).toBeTruthy();
    expect(screen.getByText(/unknown_code/)).toBeTruthy();
  });

  it('does not render the excludedByReason block when it is empty', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: { counts: emptyCounts({ totalRows: 1 }) },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-plan');
    expect(screen.queryByText('Исключено по причинам:')).toBeNull();
  });

  it('commit success shows the success banner + final counts, hides the commit button', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: { counts: emptyCounts({ totalRows: 2 }) },
    });
    commitPaymentImportAction.mockResolvedValue({
      ok: true,
      result: { counts: emptyCounts({ totalRows: 2, imported: 2 }), batchId: 'batch-1' },
    });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-commit-button');

    fireEvent.click(screen.getByTestId('payment-import-commit-button'));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('Импорт выполнен')).toBeTruthy();
    expect(screen.queryByTestId('payment-import-commit-button')).toBeNull();
  });

  it('commit shows a loading label while pending', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: true, plan: { counts: emptyCounts() } });
    let resolveCommit: (v: unknown) => void = () => {};
    commitPaymentImportAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCommit = resolve;
        })
    );
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-commit-button');

    fireEvent.click(screen.getByTestId('payment-import-commit-button'));
    expect(await screen.findByText('Импорт…')).toBeTruthy();
    resolveCommit({ ok: true, result: { counts: emptyCounts(), batchId: null } });
    await waitFor(() => expect(screen.getByText('Импорт выполнен')).toBeTruthy());
  });

  it('commit failure shows the mapped error alert, no success banner', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: true, plan: { counts: emptyCounts() } });
    commitPaymentImportAction.mockResolvedValue({ ok: false, error: 'parse_failed' });
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'a.xlsx')
    );
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-commit-button');

    fireEvent.click(screen.getByTestId('payment-import-commit-button'));
    expect(await screen.findByText('Не удалось разобрать файл')).toBeTruthy();
    expect(screen.queryByText('Импорт выполнен')).toBeNull();
  });

  it('handleCommit is a no-op when the file input has been cleared before the click', async () => {
    previewPaymentImportAction.mockResolvedValue({ ok: true, plan: { counts: emptyCounts() } });
    render(React.createElement(PaymentImportForm));
    const input = screen.getByTestId('payment-import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'a.xlsx'));
    fireEvent.click(screen.getByTestId('payment-import-preview-button'));
    await screen.findByTestId('payment-import-commit-button');

    Object.defineProperty(input, 'files', { value: [], configurable: true });
    fireEvent.click(screen.getByTestId('payment-import-commit-button'));
    expect(commitPaymentImportAction).not.toHaveBeenCalled();
  });
});

/** Т-4/Т-6 — то же самое для страницы импорта банковской выписки. */
describe('PaymentImportForm — сбой и слишком большой файл', () => {
  beforeEach(() => {
    previewPaymentImportAction.mockReset();
    commitPaymentImportAction.mockReset();
  });

  it('запрос не дошёл до сервера: красный блок вместо пустого экрана', async () => {
    previewPaymentImportAction.mockRejectedValue(new Error('Body exceeded limit'));
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'card51.xlsx')
    );
    fireEvent.submit(
      screen.getByTestId('payment-import-file-input').closest('form') as HTMLFormElement
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Сервер не принял файл');
    const button = screen.getByTestId('payment-import-preview-button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('файл больше предела: запрос НЕ уходит, показан его размер', async () => {
    render(React.createElement(PaymentImportForm));
    const big = new File(['x'], 'card51.xls');
    Object.defineProperty(big, 'size', { value: 30 * 1024 * 1024 });
    pickFile(screen.getByTestId('payment-import-file-input') as HTMLInputElement, big);
    fireEvent.submit(
      screen.getByTestId('payment-import-file-input').closest('form') as HTMLFormElement
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('больше предела в 25 МБ');
    expect(alert.textContent).toContain('30,0 МБ');
    expect(previewPaymentImportAction).not.toHaveBeenCalled();
  });

  it('сбой на подтверждении импорта тоже виден', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: {
          totalRows: 1,
          imported: 1,
          refunds: 0,
          queued: 0,
          excluded: 0,
          excludedByReason: {},
          parseErrors: 0,
        },
      },
    });
    commitPaymentImportAction.mockRejectedValue(new Error('network down'));
    render(React.createElement(PaymentImportForm));
    pickFile(
      screen.getByTestId('payment-import-file-input') as HTMLInputElement,
      new File(['x'], 'card51.xlsx')
    );
    fireEvent.submit(
      screen.getByTestId('payment-import-file-input').closest('form') as HTMLFormElement
    );
    fireEvent.click(await screen.findByTestId('payment-import-commit-button'));

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((el) => el.textContent?.includes('Сервер не принял файл'))
      ).toBe(true)
    );
  });

  it('слишком большой файл не уходит и на подтверждении', async () => {
    previewPaymentImportAction.mockResolvedValue({
      ok: true,
      plan: {
        counts: {
          totalRows: 1,
          imported: 1,
          refunds: 0,
          queued: 0,
          excluded: 0,
          excludedByReason: {},
          parseErrors: 0,
        },
      },
    });
    render(React.createElement(PaymentImportForm));
    const input = screen.getByTestId('payment-import-file-input') as HTMLInputElement;
    pickFile(input, new File(['x'], 'card51.xlsx'));
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    const commit = await screen.findByTestId('payment-import-commit-button');

    const big = new File(['x'], 'big.xlsx');
    Object.defineProperty(big, 'size', { value: 40 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    fireEvent.click(commit);

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((el) => el.textContent?.includes('больше предела'))
      ).toBe(true)
    );
    expect(commitPaymentImportAction).not.toHaveBeenCalled();
  });
});
