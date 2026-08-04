import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireAdmin,
  saveSettings,
  resetEmailTransportCache,
  resetIntegrationSettingsCache,
  resetInboundEmailAdapter,
  resetOneCAdapter,
  revalidatePath,
  testIntegration,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveSettings: vi.fn(),
  resetEmailTransportCache: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  resetInboundEmailAdapter: vi.fn(),
  resetOneCAdapter: vi.fn(),
  revalidatePath: vi.fn(),
  testIntegration: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ resetIntegrationSettingsCache }));
vi.mock('@/lib/email/transport', () => ({ resetEmailTransportCache }));
vi.mock('@/lib/inbound/email', () => ({ __resetInboundEmailAdapter: resetInboundEmailAdapter }));
vi.mock('@/lib/services/oneCSync', () => ({ resetOneCAdapter }));
vi.mock('@/lib/services/admin/testIntegration', () => ({ testIntegration }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  saveEmailSettingsAction,
  saveTelegramSettingsAction,
  saveMaxSettingsAction,
  saveWhatsappSettingsAction,
  saveMangoSettingsAction,
  saveImapSettingsAction,
  saveOnecSettingsAction,
  saveDadataSettingsAction,
  testIntegrationAction,
} from '@/server-actions/admin/integrationSettings';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1' });
  saveSettings.mockResolvedValue({ ok: true });
});

describe('saveEmailSettingsAction', () => {
  it('maps checkbox "on" to enabled=true and forwards from + apiKey', async () => {
    const res = await saveEmailSettingsAction(
      fd({ email_enabled: 'on', email_from: '  a@b.ru  ', email_resendApiKey: 're_k' })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'email.enabled', value: 'true' },
      { key: 'email.from', value: 'a@b.ru' },
      { key: 'email.resendApiKey', value: 're_k' },
    ]);
    expect(resetEmailTransportCache).toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('unchecked checkbox → enabled=false', async () => {
    await saveEmailSettingsAction(fd({ email_from: 'a@b.ru', email_resendApiKey: '' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries[0]).toEqual({ key: 'email.enabled', value: 'false' });
    expect(entries[2]).toEqual({ key: 'email.resendApiKey', value: '' }); // пустой = не менять
  });

  it('propagates secrets_key_missing and does NOT reset cache/revalidate', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveEmailSettingsAction(
      fd({ email_enabled: 'on', email_resendApiKey: 're_k' })
    );
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetEmailTransportCache).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('bot/whatsapp/mango group actions', () => {
  it('telegram: username trimmed, token forwarded as-is, cache reset', async () => {
    const res = await saveTelegramSettingsAction(
      fd({ telegram_botUsername: ' bot ', telegram_botToken: 'tk' })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'telegram.botUsername', value: 'bot' },
      { key: 'telegram.botToken', value: 'tk' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('max: mirrors telegram mapping onto max.* keys + baseUrl', async () => {
    await saveMaxSettingsAction(
      fd({ max_botUsername: 'maxbot', max_botToken: '', max_baseUrl: ' https://max/ ' })
    );
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'max.botUsername', value: 'maxbot' },
      { key: 'max.botToken', value: '' }, // пустой секрет = не менять
      { key: 'max.baseUrl', value: 'https://max/' },
    ]);
  });

  it('whatsapp: forwards baseUrl (trimmed) + both secrets', async () => {
    await saveWhatsappSettingsAction(
      fd({ whatsapp_baseUrl: ' https://agg/ ', whatsapp_apiKey: 'wk', whatsapp_channelId: 'ch' })
    );
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'whatsapp.baseUrl', value: 'https://agg/' },
      { key: 'whatsapp.apiKey', value: 'wk' },
      { key: 'whatsapp.channelId', value: 'ch' },
    ]);
  });

  it('mango: baseUrl trimmed + secrets forwarded; save error propagates without resets', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveMangoSettingsAction(
      fd({ mango_vpbxBaseUrl: ' https://vpbx/ ', mango_apiKey: 'k', mango_apiSalt: 's' })
    );
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'mango.vpbxBaseUrl', value: 'https://vpbx/' },
      { key: 'mango.apiKey', value: 'k' },
      { key: 'mango.apiSalt', value: 's' },
    ]);
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });
});

describe('saveImapSettingsAction', () => {
  it('happy path: маппинг полей, tls-чекбокс → 1, сброс адаптера входящей почты', async () => {
    const res = await saveImapSettingsAction(
      fd({
        imap_adapter: 'IMAP',
        imap_host: ' imap.host ',
        imap_port: '993',
        imap_user: 'u@h',
        imap_tls: 'on',
        imap_password: 'pw',
      })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'imap.adapter', value: 'imap' },
      { key: 'imap.host', value: 'imap.host' },
      { key: 'imap.port', value: '993' },
      { key: 'imap.user', value: 'u@h' },
      { key: 'imap.tls', value: '1' },
      { key: 'imap.password', value: 'pw' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(resetInboundEmailAdapter).toHaveBeenCalled();
  });

  it('снятый tls-чекбокс → 0', async () => {
    await saveImapSettingsAction(fd({ imap_adapter: 'fake', imap_port: '' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries.find((e: { key: string }) => e.key === 'imap.tls')).toEqual({
      key: 'imap.tls',
      value: '0',
    });
  });

  it('validation: неизвестный адаптер и нечисловой порт отвергаются до записи', async () => {
    expect(await saveImapSettingsAction(fd({ imap_adapter: 'pop3' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await saveImapSettingsAction(fd({ imap_adapter: 'imap', imap_port: 'abc' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetInboundEmailAdapter).not.toHaveBeenCalled();
  });

  it('save error propagates and does not reset the inbound adapter', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveImapSettingsAction(fd({ imap_adapter: 'fake' }));
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetInboundEmailAdapter).not.toHaveBeenCalled();
  });
});

describe('saveOnecSettingsAction', () => {
  it('happy path: маппинг полей (trim), сброс адаптера 1С', async () => {
    const res = await saveOnecSettingsAction(
      fd({
        onec_adapter: 'REST',
        onec_apiUrl: ' https://1c/ ',
        onec_healthPath: ' health ',
        onec_apiToken: 'tok',
      })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'onec.adapter', value: 'rest' },
      { key: 'onec.apiUrl', value: 'https://1c/' },
      { key: 'onec.healthPath', value: 'health' },
      { key: 'onec.apiToken', value: 'tok' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(resetOneCAdapter).toHaveBeenCalled();
  });

  it('validation: неизвестный адаптер отвергается до записи и без сброса', async () => {
    const res = await saveOnecSettingsAction(fd({ onec_adapter: 'file' }));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetOneCAdapter).not.toHaveBeenCalled();
  });

  it('save error propagates and does not reset the 1С adapter', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveOnecSettingsAction(fd({ onec_adapter: 'fake' }));
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetOneCAdapter).not.toHaveBeenCalled();
  });
});

describe('saveDadataSettingsAction', () => {
  it('checkbox on → enabled=true, ключ проброшен', async () => {
    const res = await saveDadataSettingsAction(fd({ dadata_enabled: 'on', dadata_apiKey: 'dk' }));
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'dadata.enabled', value: 'true' },
      { key: 'dadata.apiKey', value: 'dk' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
  });

  it('снятый чекбокс → enabled=false, пустой ключ = не менять', async () => {
    await saveDadataSettingsAction(fd({ dadata_apiKey: '' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'dadata.enabled', value: 'false' },
      { key: 'dadata.apiKey', value: '' },
    ]);
  });
});

describe('testIntegrationAction', () => {
  it('requireAdmin → сервис → revalidate; результат пробы пробрасывается', async () => {
    testIntegration.mockResolvedValue({ ok: true, success: true, message: 'Подключение успешно' });
    const res = await testIntegrationAction('telegram', new FormData());
    expect(res).toEqual({ ok: true, success: true, message: 'Подключение успешно' });
    expect(requireAdmin).toHaveBeenCalled();
    expect(testIntegration).toHaveBeenCalledWith(expect.anything(), { sub: 'admin-1' }, 'telegram');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('неуспешная проба тоже revalidate-ится (lastError записан в SyncState)', async () => {
    testIntegration.mockResolvedValue({
      ok: true,
      success: false,
      message: 'Сервер ответил HTTP 500',
    });
    const res = await testIntegrationAction('onec', new FormData());
    expect(res).toEqual({ ok: true, success: false, message: 'Сервер ответил HTTP 500' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('ошибка сервиса (unknown_key) → без revalidate', async () => {
    testIntegration.mockResolvedValue({ ok: false, error: 'unknown_key' });
    const res = await testIntegrationAction('nope', new FormData());
    expect(res).toEqual({ ok: false, error: 'unknown_key' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
