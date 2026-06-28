/**
 * Unit tests for src/lib/notifications/shared.ts
 *
 * Covers all three branches of orderLabel:
 *   1. orderNumber present → «№ <number>»
 *   2. orderTitle present, no orderNumber → ««<title>»»
 *   3. both null → «(без заказа)»
 * And getAppBaseUrl fallback branch.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { orderLabel, getAppBaseUrl } from '@/lib/notifications/shared';

describe('orderLabel', () => {
  it('returns «№ <number>» when orderNumber is provided', () => {
    expect(orderLabel('42', 'Some Title')).toBe('№ 42');
    expect(orderLabel('001', null)).toBe('№ 001');
  });

  it('returns ««<title>»» when only orderTitle is provided', () => {
    expect(orderLabel(null, 'Мой заказ')).toBe('«Мой заказ»');
    expect(orderLabel(null, 'Тест')).toBe('«Тест»');
  });

  it('returns «(без заказа)» when both orderNumber and orderTitle are null', () => {
    expect(orderLabel(null, null)).toBe('(без заказа)');
  });
});

describe('getAppBaseUrl', () => {
  const originalEnv = process.env.APP_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalEnv;
    }
  });

  it('returns APP_URL when set', () => {
    process.env.APP_URL = 'https://my.app.ru';
    expect(getAppBaseUrl()).toBe('https://my.app.ru');
  });

  it('returns default URL when APP_URL is not set', () => {
    delete process.env.APP_URL;
    expect(getAppBaseUrl()).toBe('https://lk.otsfera.ru');
  });

  it('trims whitespace from APP_URL', () => {
    process.env.APP_URL = '  https://my.app.ru  ';
    expect(getAppBaseUrl()).toBe('https://my.app.ru');
  });
});
