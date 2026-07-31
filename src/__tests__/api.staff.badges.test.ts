/**
 * Этап 7 (ФТ-8.4) — GET /api/staff/badges: агрегирующий счётчик меню
 * сотрудника. Только admin|manager; клиентским ролям — ответ requireRole.
 * Мок-паттерн — api.notifications.unread.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSession, requireRole, getStaffBadges } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  getStaffBadges: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/services/intake/badges', () => ({ getStaffBadges }));

import { GET } from '@/app/api/staff/badges/route';

const managerSession = { sub: 'm1', role: 'manager' as const, companyId: 'c1' };

describe('GET /api/staff/badges', () => {
  beforeEach(() => {
    requireSession.mockReset();
    requireRole.mockReset();
    getStaffBadges.mockReset();
  });

  it('401 без сессии (ответ requireSession)', async () => {
    const denied = new Response('no', { status: 401 });
    requireSession.mockResolvedValue({ ok: false, response: denied });
    expect(await GET()).toBe(denied);
    expect(getStaffBadges).not.toHaveBeenCalled();
  });

  it('403 клиентской роли (ответ requireRole)', async () => {
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'p1', role: 'partner' } });
    const denied = new Response('no', { status: 403 });
    requireRole.mockReturnValue({ ok: false, response: denied });
    expect(await GET()).toBe(denied);
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'manager']);
    expect(getStaffBadges).not.toHaveBeenCalled();
  });

  it('сотрудник получает счётчики JSON', async () => {
    requireSession.mockResolvedValue({ ok: true, value: managerSession });
    requireRole.mockReturnValue({ ok: true });
    getStaffBadges.mockResolvedValue({ intake: 3, tasksOverdue: 2 });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intake: 3, tasksOverdue: 2 });
    expect(getStaffBadges).toHaveBeenCalledWith({}, managerSession);
  });
});
