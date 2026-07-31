import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  TwoFactorCodeTemplate,
  twoFactorCodeSubject,
  twoFactorCodeText,
} from '@/lib/email/templates/two-factor-code';

describe('TwoFactorCodeTemplate', () => {
  it('renders the code and the 10-minute warning in the body', () => {
    const html = renderToStaticMarkup(
      React.createElement(TwoFactorCodeTemplate, { name: 'Иван', code: '123456' })
    );
    expect(html).toContain('123456');
    expect(html).toContain('Иван');
    expect(html).toContain('10 минут');
  });

  it('never leaks the code into the subject (lock-screen exposure)', () => {
    expect(twoFactorCodeSubject()).toBe('Код подтверждения входа');
    expect(twoFactorCodeSubject()).not.toContain('123456');
  });

  it('plain-text variant carries the code', () => {
    const text = twoFactorCodeText({ name: 'Иван', code: '654321' });
    expect(text).toContain('654321');
    expect(text).toContain('Иван');
  });
});
