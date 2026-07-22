// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { getIntegrationsStatus } = vi.hoisted(() => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@/lib/services/admin/integrations', () => ({ getIntegrationsStatus }));

const { getSettingsView } = vi.hoisted(() => ({ getSettingsView: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView }));

// Client-компонент формы — заглушка (SSR-тест страницы её не драйвит).
vi.mock('@/components/admin/email-settings-form', () => ({
  EmailSettingsForm: () => null
}));

import AdminIntegrationsPage from '@/app/admin/integrations/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminIntegrationsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getIntegrationsStatus.mockReset();
    getSettingsView.mockReset();
    requireAdmin.mockResolvedValue(SESSION);
    getSettingsView.mockResolvedValue([
      { key: 'email.enabled', isSecret: false, isSet: false, value: null, source: 'none' },
      { key: 'email.from', isSecret: false, isSet: false, value: null, source: 'none' },
      { key: 'email.resendApiKey', isSecret: true, isSet: false, value: null, source: 'none' }
    ]);
  });

  it('requires admin and renders the security notice + rows with status badges', async () => {
    getIntegrationsStatus.mockReturnValue([
      { key: 'mango', label: 'Телефония (Mango Office)', enabled: true, description: 'desc-mango', envHint: 'HINT_MANGO' },
      { key: 'telegram', label: 'Telegram-бот', enabled: false, description: 'desc-tg', envHint: 'HINT_TG' }
    ]);

    const { container } = await renderServerComponent(AdminIntegrationsPage());

    expect(requireAdmin).toHaveBeenCalled();
    const text = container.textContent ?? '';
    // security notice: секреты в БД зашифрованы, env — запасной вариант
    expect(text).toContain('Секретные ключи хранятся в базе в зашифрованном виде');
    // both rows + both badge states
    expect(text).toContain('Телефония (Mango Office)');
    expect(text).toContain('Подключено');
    expect(text).toContain('Telegram-бот');
    expect(text).toContain('Не настроено');
    // env hints are shown (they are names, not secret values)
    expect(text).toContain('HINT_MANGO');
  });
});
