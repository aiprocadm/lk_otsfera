import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Правка правил маршрутизации уведомлений (`У-127`).
 *
 * Два инварианта, ради которых файл и написан: **область правки задаёт роль**
 * (компания из сессии, а не из формы — иначе руководитель одной компании
 * переписал бы правила другой) и **«найти и обновить» вместо `upsert`**
 * (у платформенных правил `companyId` равен NULL, а в Postgres два NULL не
 * равны, и составной уникальный ключ их не различает).
 */
const {
  requireSettingsSection,
  isKnownAudience,
  isRoutableChannel,
  recordAudit,
  revalidatePath,
  findFirst,
  update,
  create,
  deleteMany,
  TYPES,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  isKnownAudience: vi.fn(),
  isRoutableChannel: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  TYPES: { order_status_changed: { label: 'Статус заказа' } } as Record<string, unknown>,
}));

vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/notifications/registry', () => ({ NOTIFICATION_TYPES: TYPES }));
vi.mock('@/lib/notifications/routing', () => ({ isKnownAudience, isRoutableChannel }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { notificationRule: { findFirst, update, create, deleteMany } },
}));

import {
  saveNotificationRuleAction,
  resetNotificationRulesAction,
} from '@/server-actions/admin/notificationRules';

const EVENT = 'order_status_changed';

beforeEach(() => {
  vi.clearAllMocks();
  isKnownAudience.mockReturnValue(true);
  isRoutableChannel.mockReturnValue(true);
  requireSettingsSection.mockResolvedValue({ sub: 'u1', companyId: 'c1' });
  findFirst.mockResolvedValue(null);
  deleteMany.mockResolvedValue({ count: 0 });
});

describe('saveNotificationRuleAction', () => {
  it('событие не из реестра — отказ, а не правило в пустоту', async () => {
    await expect(
      saveNotificationRuleAction('admin', 'придуманное', 'manager', 'email', true)
    ).resolves.toEqual({ ok: false, error: 'validation' });
    expect(create).not.toHaveBeenCalled();
  });

  it('неизвестный получатель — отказ', async () => {
    isKnownAudience.mockReturnValue(false);

    await expect(
      saveNotificationRuleAction('admin', EVENT, 'кто-то', 'email', true)
    ).resolves.toEqual({ ok: false, error: 'validation' });
  });

  it('канал, по которому не шлют, — отказ', async () => {
    isRoutableChannel.mockReturnValue(false);

    await expect(
      saveNotificationRuleAction('admin', EVENT, 'manager', 'голубь', true)
    ).resolves.toEqual({ ok: false, error: 'validation' });
  });

  it('руководитель без компании не правит платформу', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', companyId: null });

    await expect(
      saveNotificationRuleAction('leader', EVENT, 'manager', 'email', true)
    ).resolves.toEqual({ ok: false, error: 'company_required' });
  });

  it('правила ещё не было — создаём в области своей роли', async () => {
    const res = await saveNotificationRuleAction('leader', EVENT, 'manager', 'email', false);

    expect(res).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        eventType: EVENT,
        audience: 'manager',
        channel: 'email',
        enabled: false,
        updatedBy: 'u1',
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'notification_rule_changed',
        entityId: `${EVENT}:manager:email`,
        after: { enabled: false, companyId: 'c1' },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings/catalogs/notification-rules');
  });

  it('правило было — обновляем найденную строку; у админа область платформенная', async () => {
    findFirst.mockResolvedValue({ id: 'r1' });

    await saveNotificationRuleAction('admin', EVENT, 'manager', 'email', true);

    expect(findFirst).toHaveBeenCalledWith({
      where: { companyId: null, eventType: EVENT, audience: 'manager', channel: 'email' },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { enabled: true, updatedBy: 'u1' },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('resetNotificationRulesAction — «вернуть стандартные»', () => {
  it('без компании — отказ', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', companyId: null });

    await expect(resetNotificationRulesAction('leader')).resolves.toEqual({
      ok: false,
      error: 'company_required',
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('удаляет переопределения своей компании и сообщает сколько', async () => {
    deleteMany.mockResolvedValue({ count: 4 });

    await expect(resetNotificationRulesAction('leader')).resolves.toEqual({ ok: true, removed: 4 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { companyId: 'c1' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: 'c1', after: { removed: 4 } })
    );
  });

  it('у платформы в журнале пишется «platform», а не пустота', async () => {
    deleteMany.mockResolvedValue({ count: 2 });

    await expect(resetNotificationRulesAction('admin')).resolves.toEqual({ ok: true, removed: 2 });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: 'platform' })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings/catalogs/notification-rules');
  });
});
