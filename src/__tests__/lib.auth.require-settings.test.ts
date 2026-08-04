import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Серверный гард подраздела настроек. Проверяем три исхода: пускает, отказывает
 * по правам (403) и прячет раздел под выключенным флагом (404). Гард обязан
 * отрабатывать на КАЖДЫЙ запрос — это единственная реальная защита адреса
 * (карточка в хабе всего лишь не нарисована).
 */
const { requireAdmin, requireManagerLeader } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin, requireManagerLeader }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { canAccessSettingsSection } = vi.hoisted(() => ({ canAccessSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));

const nav = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

import { requireSettingsSection } from '@/lib/auth/requireSettings';

const ADMIN = { sub: 'a1', role: 'admin' };
const LEADER = { sub: 'l1', role: 'manager', managerRole: 'leader' };

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue(ADMIN);
  requireManagerLeader.mockReset().mockResolvedValue(LEADER);
  isFeatureEnabled.mockReset().mockReturnValue(true);
  canAccessSettingsSection.mockReset().mockReturnValue(true);
  nav.redirect.mockClear();
  nav.notFound.mockClear();
});

describe('requireSettingsSection', () => {
  it('админский кабинет — гард роли admin, сессия возвращается странице', async () => {
    await expect(requireSettingsSection('security.audit', 'admin')).resolves.toBe(ADMIN);
    expect(requireAdmin).toHaveBeenCalled();
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('кабинет руководителя — гард под-роли leader', async () => {
    await expect(requireSettingsSection('access.roles', 'leader')).resolves.toBe(LEADER);
    expect(requireManagerLeader).toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('нет права на раздел — 403, а не тихий показ', async () => {
    canAccessSettingsSection.mockReturnValue(false);
    await expect(requireSettingsSection('security.audit', 'admin')).rejects.toThrow('REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('раздел под выключенным флагом — 404 (существование фичи не раскрываем)', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(requireSettingsSection('access.roles', 'admin')).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('role_constructor');
    expect(nav.notFound).toHaveBeenCalled();
  });

  it('раздел без флага флаги не читает', async () => {
    await requireSettingsSection('security.audit', 'admin');
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });
});
