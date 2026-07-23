import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isTelegramEnabled, isMaxEnabled, isWhatsAppEnabled } = vi.hoisted(() => ({
  isTelegramEnabled: vi.fn(),
  isMaxEnabled: vi.fn(),
  isWhatsAppEnabled: vi.fn()
}));
vi.mock('@/lib/telegram/client', () => ({ isTelegramEnabled }));
vi.mock('@/lib/max/client', () => ({ isMaxEnabled }));
vi.mock('@/lib/whatsapp/aggregator', () => ({ isWhatsAppEnabled }));

import { getIntegrationsStatus } from '@/lib/services/admin/integrations';

const ORIGINAL_ENV = { ...process.env };

function byKey(key: string) {
  return getIntegrationsStatus().find((i) => i.key === key)!;
}

describe('getIntegrationsStatus', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    isTelegramEnabled.mockReturnValue(false);
    isMaxEnabled.mockReturnValue(false);
    isWhatsAppEnabled.mockReturnValue(false);
    delete process.env.ONE_C_ADAPTER;
    delete process.env.FEATURE_TELEPHONY_MANGO;
    delete process.env.MANGO_API_KEY;
    delete process.env.MANGO_API_SALT;
    delete process.env.DADATA_ENABLED;
    delete process.env.DADATA_API_KEY;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns all six integrations in a stable order', () => {
    const keys = getIntegrationsStatus().map((i) => i.key);
    expect(keys).toEqual(['onec', 'mango', 'telegram', 'max', 'whatsapp', 'dadata']);
  });

  it('never leaks secret values — only booleans and env-hint names', () => {
    process.env.MANGO_API_KEY = 'super-secret-key';
    process.env.MANGO_API_SALT = 'super-secret-salt';
    const serialized = JSON.stringify(getIntegrationsStatus());
    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain('super-secret-salt');
  });

  it('1С: enabled only when ONE_C_ADAPTER=rest', () => {
    expect(byKey('onec').enabled).toBe(false);
    process.env.ONE_C_ADAPTER = 'rest';
    expect(byKey('onec').enabled).toBe(true);
    process.env.ONE_C_ADAPTER = 'fake';
    expect(byKey('onec').enabled).toBe(false);
  });

  it('Mango: enabled only when flag is truthy AND both key+salt are present', () => {
    expect(byKey('mango').enabled).toBe(false);
    process.env.FEATURE_TELEPHONY_MANGO = '1';
    expect(byKey('mango').enabled).toBe(false); // ключей ещё нет
    process.env.MANGO_API_KEY = 'k';
    process.env.MANGO_API_SALT = 's';
    expect(byKey('mango').enabled).toBe(true);
    process.env.FEATURE_TELEPHONY_MANGO = 'off';
    expect(byKey('mango').enabled).toBe(false); // флаг выключен
  });

  it('DaData: enabled only when flag is truthy AND apiKey is present', () => {
    expect(byKey('dadata').enabled).toBe(false);
    process.env.DADATA_ENABLED = '1';
    expect(byKey('dadata').enabled).toBe(false); // ключа ещё нет
    process.env.DADATA_API_KEY = 'dk';
    expect(byKey('dadata').enabled).toBe(true);
    process.env.DADATA_ENABLED = 'off';
    expect(byKey('dadata').enabled).toBe(false); // флаг выключен
  });

  it('messengers reflect their is*Enabled() helpers', () => {
    isTelegramEnabled.mockReturnValue(true);
    isMaxEnabled.mockReturnValue(false);
    isWhatsAppEnabled.mockReturnValue(true);
    expect(byKey('telegram').enabled).toBe(true);
    expect(byKey('max').enabled).toBe(false);
    expect(byKey('whatsapp').enabled).toBe(true);
  });

  it('every row carries a label, description and env-hint', () => {
    for (const row of getIntegrationsStatus()) {
      expect(row.label).toBeTruthy();
      expect(row.description).toBeTruthy();
      expect(row.envHint).toBeTruthy();
    }
  });
});
