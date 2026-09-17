import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: () => true }));
vi.mock('@/lib/email/send', () => ({
  sendDailyDigestEmail: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getDigestSettings, updateDigestSettings } from '@/lib/services/notifications/digest';
import type { SessionPayload } from '@/lib/auth/jwt';

/** Настройки дайджеста (`У-230`, `В-5-2`, `В-5-3`): только заказчик и партнёр, час 0…23, аудит. */

const findUnique = vi.fn();
const update = vi.fn();
const prisma = { user: { findUnique, update } } as unknown as PrismaClient;
const org = { sub: 'o1', role: 'organization', organizationId: 'org1' } as SessionPayload;
const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ digestEnabled: false, digestHourMsk: 9, digestLastSentAt: null });
  update.mockResolvedValue({ digestEnabled: true, digestHourMsk: 18, digestLastSentAt: null });
});

describe('getDigestSettings', () => {
  it('заказчику: положен, выключен по умолчанию, час 09:00', async () => {
    const r = await getDigestSettings(prisma, org);
    expect(r.settings).toEqual({ eligible: true, enabled: false, hourMsk: 9, lastSentAt: null });
  });

  it('сотруднику: не положен, даже если в базе включён', async () => {
    findUnique.mockResolvedValue({ digestEnabled: true, digestHourMsk: 9, digestLastSentAt: null });
    const r = await getDigestSettings(prisma, manager);
    expect(r.settings.eligible).toBe(false);
    expect(r.settings.enabled).toBe(false);
  });

  it('пользователь не найден — умолчания, не падение', async () => {
    findUnique.mockResolvedValue(null);
    const r = await getDigestSettings(prisma, org);
    expect(r.settings).toMatchObject({ enabled: false, hourMsk: 9 });
  });
});

describe('updateDigestSettings', () => {
  it('сотруднику — forbidden, база не трогается', async () => {
    const r = await updateDigestSettings(prisma, manager, { enabled: true, hourMsk: 9 });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('час вне 0…23 или не целый — invalid_hour', async () => {
    for (const hourMsk of [-1, 24, 9.5, Number.NaN]) {
      expect(await updateDigestSettings(prisma, org, { enabled: true, hourMsk })).toEqual({
        ok: false,
        error: 'invalid_hour',
      });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('пишет настройки и аудит с before/after', async () => {
    const r = await updateDigestSettings(prisma, org, { enabled: true, hourMsk: 18 });
    expect(r).toEqual({
      ok: true,
      settings: { eligible: true, enabled: true, hourMsk: 18, lastSentAt: null },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: { digestEnabled: true, digestHourMsk: 18 },
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'notification_digest_changed',
        before: { enabled: false, hourMsk: 9 },
        after: { enabled: true, hourMsk: 18 },
      })
    );
  });

  it('границы часа: 0 и 23 допустимы', async () => {
    update.mockResolvedValue({ digestEnabled: true, digestHourMsk: 0, digestLastSentAt: null });
    expect((await updateDigestSettings(prisma, org, { enabled: true, hourMsk: 0 })).ok).toBe(true);
    expect((await updateDigestSettings(prisma, org, { enabled: true, hourMsk: 23 })).ok).toBe(true);
  });
});
