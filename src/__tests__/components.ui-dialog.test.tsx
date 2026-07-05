// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { pickInitialFocus, Dialog, type DialogProps } from '@/components/ui/dialog';

type El = { tagName: string; getAttribute: (n: string) => string | null };
const make = (tagName: string, type?: string): El => ({
  tagName,
  getAttribute: (n) => (n === 'type' ? (type ?? null) : null)
});

// React.createElement's overloads require `children` up front when a
// component's props type declares it non-optional (DialogProps.children is
// required). Folding it into the props object sidesteps that without
// resorting to JSX (banned in this project's test files — classic runtime).
function renderDialog(props: DialogProps) {
  return React.createElement(Dialog, props);
}

describe('pickInitialFocus', () => {
  const panel = make('DIALOG');

  it('prefers the first form control', () => {
    const input = make('INPUT');
    expect(pickInitialFocus([make('A'), input, make('BUTTON', 'submit')], panel)).toBe(input);
  });

  it('falls back to the submit button when there is no form control', () => {
    const submit = make('BUTTON', 'submit');
    expect(pickInitialFocus([make('A'), submit, make('BUTTON', 'button')], panel)).toBe(submit);
  });

  it('falls back to the first focusable when neither', () => {
    const link = make('A');
    expect(pickInitialFocus([link, make('BUTTON', 'button')], panel)).toBe(link);
  });

  it('falls back to the panel when there are no focusables', () => {
    expect(pickInitialFocus([], panel)).toBe(panel);
  });
});

describe('Dialog (SSR structural contract)', () => {
  it('wires an accessible name from the title', () => {
    const html = renderToString(
      renderDialog({ open: true, onClose: () => {}, title: 'Заголовок', children: 'тело' })
    );
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('Заголовок');
    expect(html).toContain('тело');
    expect(html).toContain('aria-label="Закрыть"');
  });

  it('renders the error into an assertive live region', () => {
    const html = renderToString(
      renderDialog({ open: true, onClose: () => {}, title: 'T', error: 'Сломалось', children: 'тело' })
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Сломалось');
  });

  it('renders the notice into a polite live region', () => {
    const html = renderToString(
      renderDialog({ open: true, onClose: () => {}, title: 'T', notice: 'Готово', children: 'тело' })
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Готово');
  });
});

describe('Dialog (imperative showModal/close + handlers, jsdom)', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom has no native <dialog> behaviour: showModal()/close() are no-ops
    // and don't toggle the `open` attribute, but the browser's real
    // showModal() does — and testing-library's role queries only see
    // descendants of a dialog that has `open` set (matches real top-layer
    // semantics), so the mocks replicate that attribute toggle.
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  it('open=true calls showModal() and focuses the first form control', async () => {
    const onClose = vi.fn();
    render(
      renderDialog({
        open: true,
        onClose,
        title: 'Форма',
        children: [
          React.createElement('input', { key: 'i', 'aria-label': 'Имя' }),
          React.createElement('button', { key: 'b', type: 'submit' }, 'Сохранить')
        ]
      })
    );
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(screen.getByLabelText('Имя'));
  });

  it('open=false does not call showModal (el.open стартует false, ветка !el.open неверна)', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: false, onClose, title: 'T', children: 'тело' }));
    expect(showModal).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('переключение open=true -> false вызывает close()', async () => {
    const onClose = vi.fn();
    const { rerender } = render(renderDialog({ open: true, onClose, title: 'T', children: 'тело' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    rerender(renderDialog({ open: false, onClose, title: 'T', children: 'тело' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it('размонтирование во время open вызывает close() (cleanup-эффект)', async () => {
    const onClose = vi.fn();
    const { unmount } = render(renderDialog({ open: true, onClose, title: 'T', children: 'тело' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('Escape (cancel-событие): closeOnBackdrop=true, busy=false -> onClose вызывается', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', children: 'тело' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape игнорируется, когда busy=true', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', busy: true, children: 'тело' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    const evt = new Event('cancel', { cancelable: true });
    fireEvent(dialogEl, evt);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('клик по backdrop (сам <dialog>) закрывает при closeOnBackdrop=true, busy=false', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', children: 'тело' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(dialogEl);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('клик по backdrop игнорируется при closeOnBackdrop=false', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', closeOnBackdrop: false, children: 'тело' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(dialogEl);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('клик по backdrop игнорируется при busy=true', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', busy: true, children: 'тело' }));
    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.click(dialogEl);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('клик по внутреннему контенту не закрывает (stopPropagation)', () => {
    const onClose = vi.fn();
    render(
      renderDialog({
        open: true,
        onClose,
        title: 'Заголовок',
        children: React.createElement('p', { key: 'p' }, 'тело')
      })
    );
    fireEvent.click(screen.getByText('тело'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('кнопка «×» вызывает onClose, когда не busy', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', children: 'тело' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('кнопка «×» не вызывает onClose, когда busy', () => {
    const onClose = vi.fn();
    render(renderDialog({ open: true, onClose, title: 'T', busy: true, children: 'тело' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('без form control/submit в детях фокусируется первый focusable — сама кнопка «×» (она всегда рендерится первой в шапке)', async () => {
    const onClose = vi.fn();
    render(
      renderDialog({
        open: true,
        onClose,
        title: 'T',
        children: React.createElement('a', { key: 'a', href: '#x' }, 'ссылка')
      })
    );
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }));
  });
});
