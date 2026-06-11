import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { resolveErrorText, useFormAction, type ActionResult } from '@/lib/ui/useFormAction';

describe('resolveErrorText', () => {
  it('errorMap формы имеет приоритет над общим словарём', () => {
    expect(resolveErrorText('not_found', { not_found: 'Пользователь не найден.' })).toBe(
      'Пользователь не найден.'
    );
  });

  it('без errorMap берёт строку из errorMessageRu', () => {
    expect(resolveErrorText('too_large')).toBe('Файл превышает 20 МБ.');
  });

  it('неизвестный код виден в fallback (паттерн translateError)', () => {
    expect(resolveErrorText('weird_code')).toBe('Ошибка: weird_code');
  });
});

describe('useFormAction (начальное состояние)', () => {
  function Probe() {
    const action = async (): Promise<ActionResult<{ inviteUrl: string }>> => ({
      ok: false,
      error: 'validation',
    });
    const { pending, errorText, data, success, formAction } = useFormAction({ action });
    return (
      <form action={formAction}>
        <output>{JSON.stringify({ pending, errorText, data, success })}</output>
      </form>
    );
  }

  it('idle: pending=false, errorText=null, data=null, success=false', () => {
    const html = renderToString(<Probe />).replace(/&quot;/g, '"');
    expect(html).toContain(
      JSON.stringify({ pending: false, errorText: null, data: null, success: false })
    );
  });
});
