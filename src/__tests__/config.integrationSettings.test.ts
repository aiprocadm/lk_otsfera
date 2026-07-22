import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordAuditMock, keyState } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  keyState: { configured: true }
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/crypto/secrets', () => ({
  encryptSecret: (s: string) => `ENC(${s})`,
  decryptSecret: (s: string) => s.replace(/^ENC\(|\)$/g, ''),
  isSecretsKeyConfigured: () => keyState.configured
}));

import {
  getSettingValue,
  getSettingsView,
  saveSettings
} from '@/lib/config/integrationSettings';

const ORIGINAL_ENV = { ...process.env };

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    integrationSetting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides
    }
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  keyState.configured = true;
  process.env = { ...ORIGINAL_ENV };
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('getSettingValue', () => {
  it('returns a non-secret value straight from DB', async () => {
    const prisma = makePrisma({
      findUnique: vi.fn().mockResolvedValue({ value: 'noreply@x.ru', isSecret: false })
    });
    expect(await getSettingValue(prisma, 'email.from')).toBe('noreply@x.ru');
  });

  it('decrypts a secret value from DB', async () => {
    const prisma = makePrisma({
      findUnique: vi.fn().mockResolvedValue({ value: 'ENC(re_live_123)', isSecret: true })
    });
    expect(await getSettingValue(prisma, 'email.resendApiKey')).toBe('re_live_123');
  });

  it('falls back to env when DB has no row', async () => {
    process.env.EMAIL_FROM = 'env@x.ru';
    const prisma = makePrisma();
    expect(await getSettingValue(prisma, 'email.from')).toBe('env@x.ru');
  });

  it('falls back to env when DB value is empty string', async () => {
    process.env.RESEND_API_KEY = 'env-key';
    const prisma = makePrisma({ findUnique: vi.fn().mockResolvedValue({ value: '', isSecret: true }) });
    expect(await getSettingValue(prisma, 'email.resendApiKey')).toBe('env-key');
  });

  it('returns null when neither DB nor env has a value', async () => {
    delete process.env.EMAIL_FROM;
    expect(await getSettingValue(makePrisma(), 'email.from')).toBeNull();
  });
});

describe('getSettingsView', () => {
  it('masks secret values (value=null, only isSet) and exposes non-secrets', async () => {
    process.env.MANGO_VPBX_BASE_URL = '';
    const prisma = makePrisma({
      findMany: vi.fn().mockResolvedValue([
        { key: 'email.resendApiKey', value: 'ENC(secret)', isSecret: true },
        { key: 'email.from', value: 'db@x.ru', isSecret: false }
      ])
    });
    const view = await getSettingsView(prisma, ['email.resendApiKey', 'email.from']);
    const secret = view.find((r) => r.key === 'email.resendApiKey')!;
    const nonSecret = view.find((r) => r.key === 'email.from')!;

    expect(secret.value).toBeNull();
    expect(secret.isSet).toBe(true);
    expect(secret.source).toBe('db');
    expect(nonSecret.value).toBe('db@x.ru');
  });

  it('reports source=env when only env has the value, none when nothing set', async () => {
    process.env.EMAIL_FROM = 'env@x.ru';
    delete process.env.RESEND_API_KEY;
    const prisma = makePrisma();
    const view = await getSettingsView(prisma, ['email.from', 'email.resendApiKey']);
    expect(view.find((r) => r.key === 'email.from')!.source).toBe('env');
    expect(view.find((r) => r.key === 'email.resendApiKey')!.source).toBe('none');
    expect(view.find((r) => r.key === 'email.resendApiKey')!.isSet).toBe(false);
  });
});

describe('saveSettings', () => {
  it('encrypts secrets and stores non-secrets in the clear; writes one audit record', async () => {
    const prisma = makePrisma();
    const res = await saveSettings(prisma, 'admin-1', [
      { key: 'email.enabled', value: 'true' },
      { key: 'email.resendApiKey', value: 're_new' }
    ]);
    expect(res).toEqual({ ok: true });

    const upsert = prisma.integrationSetting.upsert as unknown as ReturnType<typeof vi.fn>;
    const calls = upsert.mock.calls.map((c) => c[0]);
    const enabledCall = calls.find((c) => c.where.key === 'email.enabled')!;
    const secretCall = calls.find((c) => c.where.key === 'email.resendApiKey')!;
    expect(enabledCall.create.value).toBe('true'); // открытым
    expect(secretCall.create.value).toBe('ENC(re_new)'); // зашифровано
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'integration_settings_updated', entity: 'integration_setting' })
    );
    // Значение секрета не попадает в аудит
    const auditArg = recordAuditMock.mock.calls[0][1];
    expect(JSON.stringify(auditArg)).not.toContain('re_new');
  });

  it('empty secret does not overwrite the stored one (no upsert for it)', async () => {
    const prisma = makePrisma();
    await saveSettings(prisma, 'admin-1', [{ key: 'email.resendApiKey', value: '' }]);
    expect(prisma.integrationSetting.upsert).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled(); // ничего не изменилось
  });

  it('clear removes the row (falls back to env afterwards)', async () => {
    const prisma = makePrisma();
    await saveSettings(prisma, 'admin-1', [{ key: 'email.from', clear: true }]);
    expect(prisma.integrationSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'email.from' } });
  });

  it('refuses to write a secret when the encryption key is missing', async () => {
    keyState.configured = false;
    const prisma = makePrisma();
    const res = await saveSettings(prisma, 'admin-1', [{ key: 'email.resendApiKey', value: 're_x' }]);
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(prisma.integrationSetting.upsert).not.toHaveBeenCalled();
  });
});
