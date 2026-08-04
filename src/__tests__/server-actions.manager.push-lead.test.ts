/**
 * Тонкий адаптер ручной отправки лида в 1С: валидация формы входа, гард роли,
 * прокидка Result и revalidatePath. Идемпотентность, jobId и деградация
 * очереди — в services.manager.leadPush.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, revalidatePath, pushLeadToOneC } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  pushLeadToOneC: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/leadPush', () => ({ pushLeadToOneC }));

import { prisma } from '@/lib/db/prisma';
import { pushLeadToOneCAction } from '@/server-actions/manager/leads';

const MGR = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(MGR);
});

describe('pushLeadToOneCAction', () => {
  it('validation при пустом leadId — до сервиса не доходит', async () => {
    const res = await pushLeadToOneCAction({ leadId: '' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(requireManager).not.toHaveBeenCalled();
    expect(pushLeadToOneC).not.toHaveBeenCalled();
  });

  it('validation при leadId длиннее 64 символов', async () => {
    const res = await pushLeadToOneCAction({ leadId: 'x'.repeat(65) });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(pushLeadToOneC).not.toHaveBeenCalled();
  });

  it('успех: делегирует в сервис и ревалидирует карточку лида', async () => {
    pushLeadToOneC.mockResolvedValue({ ok: true });

    const res = await pushLeadToOneCAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: true });
    expect(pushLeadToOneC).toHaveBeenCalledWith(prisma, MGR, { leadId: 'l1' });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/leads/l1');
  });

  it('коды отказа сервиса прокидываются без ревалидации', async () => {
    for (const error of ['not_found', 'already_pushed', 'queue_unavailable']) {
      pushLeadToOneC.mockResolvedValue({ ok: false, error });
      expect(await pushLeadToOneCAction({ leadId: 'l1' })).toEqual({ ok: false, error });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
