import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, isFeatureEnabledMock, generateBackupCodesMock, recordAuditMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    isFeatureEnabledMock: vi.fn(),
    generateBackupCodesMock: vi.fn(),
    recordAuditMock: vi.fn(),
  }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: isFeatureEnabledMock }));
vi.mock('@/lib/services/auth/twoFactor', () => ({ generateBackupCodes: generateBackupCodesMock }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { regenerateBackupCodesAction } from '@/server-actions/staff/backupCodes';

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabledMock.mockReturnValue(true);
  generateBackupCodesMock.mockResolvedValue({
    codes: Array.from({ length: 10 }, (_, i) => `CODE${i}`),
  });
  recordAuditMock.mockResolvedValue(undefined);
});

describe('regenerateBackupCodesAction', () => {
  it('manager: returns 10 codes and audits the regeneration', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'manager' });
    const r = await regenerateBackupCodesAction();
    expect(r).toEqual({ ok: true, codes: expect.any(Array) });
    if (r.ok) expect(r.codes).toHaveLength(10);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_backup_regenerated', entityId: 'u1' })
    );
  });

  it('admin: allowed', async () => {
    getSessionMock.mockResolvedValue({ sub: 'a1', role: 'admin' });
    expect((await regenerateBackupCodesAction()).ok).toBe(true);
  });

  it('partner: forbidden', async () => {
    getSessionMock.mockResolvedValue({ sub: 'p1', role: 'partner' });
    expect(await regenerateBackupCodesAction()).toEqual({ ok: false, error: 'forbidden' });
    expect(generateBackupCodesMock).not.toHaveBeenCalled();
  });

  it('no session: forbidden', async () => {
    getSessionMock.mockResolvedValue(null);
    expect(await regenerateBackupCodesAction()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('flag OFF: forbidden even for staff', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'manager' });
    isFeatureEnabledMock.mockReturnValue(false);
    expect(await regenerateBackupCodesAction()).toEqual({ ok: false, error: 'forbidden' });
    expect(generateBackupCodesMock).not.toHaveBeenCalled();
  });

  it('audit failure does not break the action', async () => {
    getSessionMock.mockResolvedValue({ sub: 'u1', role: 'manager' });
    recordAuditMock.mockRejectedValue(new Error('audit down'));
    expect((await regenerateBackupCodesAction()).ok).toBe(true);
  });
});
