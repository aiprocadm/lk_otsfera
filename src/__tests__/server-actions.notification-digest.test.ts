import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, isFeatureEnabled, updateDigestSettings } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  isFeatureEnabled: vi.fn(),
  updateDigestSettings: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/notifications/digest', () => ({ updateDigestSettings }));

import { updateDigestSettingsAction } from '@/server-actions/notification-digest';

/** Действие галочки дайджеста (`У-230`): сессия, флаг, делегирование сервису. */

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ sub: 'o1', role: 'organization' });
  isFeatureEnabled.mockReturnValue(true);
  updateDigestSettings.mockResolvedValue({ ok: true, settings: { enabled: true, hourMsk: 9 } });
});

describe('updateDigestSettingsAction', () => {
  it('делегирует сервису с сессией', async () => {
    const res = await updateDigestSettingsAction(true, 9);
    expect(res.ok).toBe(true);
    expect(updateDigestSettings).toHaveBeenCalledWith(
      {},
      { sub: 'o1', role: 'organization' },
      { enabled: true, hourMsk: 9 }
    );
  });

  it('без флага — отказ, сервис не зовётся', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await updateDigestSettingsAction(true, 9)).toEqual({
      ok: false,
      error: 'feature_disabled',
    });
    expect(updateDigestSettings).not.toHaveBeenCalled();
  });
});
