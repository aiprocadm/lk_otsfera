import { describe, expect, it, afterEach } from 'vitest';
import {
  oneCMode,
  oneCHttpTimeoutMs,
  oneCCursorOverlapMinutes,
  oneCDefaultCompanyId,
} from '@/lib/services/oneCSync/config';

describe('oneCSync config', () => {
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    delete process.env.ONE_C_HTTP_TIMEOUT_MS;
    delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
    delete process.env.ONE_C_COMPANY_ID;
  });

  it('oneCMode defaults to live and reads shadow case-insensitively', () => {
    expect(oneCMode()).toBe('live');
    process.env.ONE_C_MODE = 'SHADOW';
    expect(oneCMode()).toBe('shadow');
    process.env.ONE_C_MODE = 'anything-else';
    expect(oneCMode()).toBe('live');
  });

  it('oneCHttpTimeoutMs defaults to 15000 and rejects non-positive', () => {
    expect(oneCHttpTimeoutMs()).toBe(15000);
    process.env.ONE_C_HTTP_TIMEOUT_MS = '8000';
    expect(oneCHttpTimeoutMs()).toBe(8000);
    process.env.ONE_C_HTTP_TIMEOUT_MS = '0';
    expect(oneCHttpTimeoutMs()).toBe(15000);
  });

  it('oneCCursorOverlapMinutes defaults to 5 and allows 0', () => {
    expect(oneCCursorOverlapMinutes()).toBe(5);
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '0';
    expect(oneCCursorOverlapMinutes()).toBe(0);
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = 'bad';
    expect(oneCCursorOverlapMinutes()).toBe(5);
  });

  // Этап 6 (Т-41): компания для организаций, создаваемых сетевой синхронизацией.
  it('oneCDefaultCompanyId: не задан/пусто/пробелы → null, значение тримится', () => {
    expect(oneCDefaultCompanyId()).toBeNull();
    process.env.ONE_C_COMPANY_ID = '';
    expect(oneCDefaultCompanyId()).toBeNull();
    process.env.ONE_C_COMPANY_ID = '   ';
    expect(oneCDefaultCompanyId()).toBeNull();
    process.env.ONE_C_COMPANY_ID = '  co-42  ';
    expect(oneCDefaultCompanyId()).toBe('co-42');
  });
});
