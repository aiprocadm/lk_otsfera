import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { pickInitialFocus, Dialog } from '@/components/ui/dialog';

type El = { tagName: string; getAttribute: (n: string) => string | null };
const make = (tagName: string, type?: string): El => ({
  tagName,
  getAttribute: (n) => (n === 'type' ? (type ?? null) : null)
});

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
      <Dialog open onClose={() => {}} title='Заголовок'>тело</Dialog>
    );
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('Заголовок');
    expect(html).toContain('тело');
    expect(html).toContain('aria-label="Закрыть"');
  });

  it('renders the error into an assertive live region', () => {
    const html = renderToString(
      <Dialog open onClose={() => {}} title='T' error='Сломалось'>тело</Dialog>
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Сломалось');
  });

  it('renders the notice into a polite live region', () => {
    const html = renderToString(
      <Dialog open onClose={() => {}} title='T' notice='Готово'>тело</Dialog>
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Готово');
  });
});
