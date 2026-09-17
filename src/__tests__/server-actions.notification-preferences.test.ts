import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, isFeatureEnabled, saveNotificationPreference } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  isFeatureEnabled: vi.fn(),
  saveNotificationPreference: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/notifications/eventPreferences', () => ({ saveNotificationPreference }));

import { saveNotificationPreferenceAction } from '@/server-actions/notification-preferences';

/** Действие матрицы «событие × канал» (`У-229`): сессия, флаг, делегирование. */

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'u1', role: 'partner' });
  isFeatureEnabled.mockReturnValue(true);
  saveNotificationPreference.mockResolvedValue({ ok: true, channels: ['email'] });
});

describe('saveNotificationPreferenceAction', () => {
  it('делегирует сервису с сессией', async () => {
    const res = await saveNotificationPreferenceAction('commission_statement_ready', ['email']);
    expect(res).toEqual({ ok: true, channels: ['email'] });
    expect(saveNotificationPreference).toHaveBeenCalledWith(
      {},
      { sub: 'u1', role: 'partner' },
      { eventType: 'commission_statement_ready', channels: ['email'] }
    );
  });

  it('без флага — отказ, сервис не зовётся', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const res = await saveNotificationPreferenceAction('commission_statement_ready', ['email']);
    expect(res).toEqual({ ok: false, error: 'feature_disabled' });
    expect(saveNotificationPreference).not.toHaveBeenCalled();
  });
});
