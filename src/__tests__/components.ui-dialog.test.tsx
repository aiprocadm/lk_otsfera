import { describe, it, expect } from 'vitest';
import { pickInitialFocus } from '@/components/ui/dialog';

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
