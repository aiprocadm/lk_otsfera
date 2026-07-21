// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { getIntegrationsStatus } = vi.hoisted(() => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@/lib/services/admin/integrations', () => ({ getIntegrationsStatus }));

import AdminIntegrationsPage from '@/app/admin/integrations/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminIntegrationsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getIntegrationsStatus.mockReset();
    requireAdmin.mockResolvedValue(SESSION);
  });

  it('requires admin and renders the security notice + rows with status badges', async () => {
    getIntegrationsStatus.mockReturnValue([
      { key: 'mango', label: 'Телефония (Mango Office)', enabled: true, description: 'desc-mango', envHint: 'HINT_MANGO' },
      { key: 'telegram', label: 'Telegram-бот', enabled: false, description: 'desc-tg', envHint: 'HINT_TG' }
    ]);

    const { container } = await renderServerComponent(AdminIntegrationsPage());

    expect(requireAdmin).toHaveBeenCalled();
    const text = container.textContent ?? '';
    // security notice: keys live in env, not in UI
    expect(text).toContain('Ключи и токены настраиваются администратором');
    // both rows + both badge states
    expect(text).toContain('Телефония (Mango Office)');
    expect(text).toContain('Подключено');
    expect(text).toContain('Telegram-бот');
    expect(text).toContain('Не настроено');
    // env hints are shown (they are names, not secret values)
    expect(text).toContain('HINT_MANGO');
  });
});
