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
      ['invalid_file', 'Выберите файл .xls или .xlsx (не более 20 МБ)'],
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
