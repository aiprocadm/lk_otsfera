import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireAdmin,
  saveSettings,
  resetEmailTransportCache,
  resetIntegrationSettingsCache,
  resetInboundEmailAdapter,
  revalidatePath
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveSettings: vi.fn(),
  resetEmailTransportCache: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  resetInboundEmailAdapter: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ resetIntegrationSettingsCache }));
vi.mock('@/lib/email/transport', () => ({ resetEmailTransportCache }));
vi.mock('@/lib/inbound/email', () => ({ __resetInboundEmailAdapter: resetInboundEmailAdapter }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  saveEmailSettingsAction,
  saveTelegramSettingsAction,
  saveMaxSettingsAction,
  saveWhatsappSettingsAction,
  saveMangoSettingsAction,
  saveImapSettingsAction
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
    const res = await saveEmailSettingsAction(fd({ email_enabled: 'on', email_from: '  a@b.ru  ', email_resendApiKey: 're_k' }));
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(
      expect.anything(),
      'admin-1',
      [
        { key: 'email.enabled', value: 'true' },
        { key: 'email.from', value: 'a@b.ru' },
        { key: 'email.resendApiKey', value: 're_k' }
      ]
    );
    expect(resetEmailTransportCache).toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integrations');
  });

  it('unchecked checkbox → enabled=false', async () => {
    await saveEmailSettingsAction(fd({ email_from: 'a@b.ru', email_resendApiKey: '' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries[0]).toEqual({ key: 'email.enabled', value: 'false' });
    expect(entries[2]).toEqual({ key: 'email.resendApiKey', value: '' }); // пустой = не менять
  });

  it('propagates secrets_key_missing and does NOT reset cache/revalidate', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveEmailSettingsAction(fd({ email_enabled: 'on', email_resendApiKey: 're_k' }));
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetEmailTransportCache).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('bot/whatsapp/mango group actions', () => {
  it('telegram: username trimmed, token forwarded as-is, cache reset', async () => {
    const res = await saveTelegramSettingsAction(fd({ telegram_botUsername: ' bot ', telegram_botToken: 'tk' }));
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'telegram.botUsername', value: 'bot' },
      { key: 'telegram.botToken', value: 'tk' }
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/admin/integrations');
  });

  it('max: mirrors telegram mapping onto max.* keys', async () => {
    await saveMaxSettingsAction(fd({ max_botUsername: 'maxbot', max_botToken: '' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'max.botUsername', value: 'maxbot' },
      { key: 'max.botToken', value: '' } // пустой секрет = не менять
    ]);
  });

  it('whatsapp: forwards both secrets', async () => {
    await saveWhatsappSettingsAction(fd({ whatsapp_apiKey: 'wk', whatsapp_channelId: 'ch' }));
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'whatsapp.apiKey', value: 'wk' },
      { key: 'whatsapp.channelId', value: 'ch' }
    ]);
  });

  it('mango: baseUrl trimmed + secrets forwarded; save error propagates without resets', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveMangoSettingsAction(fd({ mango_vpbxBaseUrl: ' https://vpbx/ ', mango_apiKey: 'k', mango_apiSalt: 's' }));
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'mango.vpbxBaseUrl', value: 'https://vpbx/' },
      { key: 'mango.apiKey', value: 'k' },
      { key: 'mango.apiSalt', value: 's' }
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
        imap_password: 'pw'
      })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'imap.adapter', value: 'imap' },
      { key: 'imap.host', value: 'imap.host' },
      { key: 'imap.port', value: '993' },
      { key: 'imap.user', value: 'u@h' },
      { key: 'imap.tls', value: '1' },
      { key: 'imap.password', value: 'pw' }
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(resetInboundEmailAdapter).toHaveBeenCalled();
  });

  it('снятый tls-чекбокс → 0', async () => {
    await saveImapSettingsAction(fd({ imap_adapter: 'fake', imap_port: '' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries.find((e: { key: string }) => e.key === 'imap.tls')).toEqual({ key: 'imap.tls', value: '0' });
  });

  it('validation: неизвестный адаптер и нечисловой порт отвергаются до записи', async () => {
    expect(await saveImapSettingsAction(fd({ imap_adapter: 'pop3' }))).toEqual({ ok: false, error: 'validation' });
    expect(await saveImapSettingsAction(fd({ imap_adapter: 'imap', imap_port: 'abc' }))).toEqual({
      ok: false,
      error: 'validation'
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
