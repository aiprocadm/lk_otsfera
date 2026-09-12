// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { SecretsKeyNotice } from '@/components/admin/secrets-key-notice';

/** `У-132`: предупреждение об отсутствии ключа шифрования — до форм с секретами. */
describe('SecretsKeyNotice', () => {
  it('ключ задан — ничего не рисует', () => {
    expect(renderToString(<SecretsKeyNotice ready />)).toBe('');
  });

  it('ключа нет — предупреждение с именем переменной и что делать', () => {
    const html = renderToString(<SecretsKeyNotice ready={false} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Сохранение секретов недоступно');
    expect(html).toContain('APP_ENCRYPTION_KEY');
    expect(html).toContain('перезапустите приложение');
  });
});
