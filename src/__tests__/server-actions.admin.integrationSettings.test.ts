import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAdmin, saveSettings, resetEmailTransportCache, revalidatePath } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveSettings: vi.fn(),
  resetEmailTransportCache: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings }));
vi.mock('@/lib/email/transport', () => ({ resetEmailTransportCache }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { saveEmailSettingsAction } from '@/server-actions/admin/integrationSettings';

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
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
