import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Аудит A1: чтение зрителя welcome-блока (ФТ-10.4) уехало с дашбордов
 * организации и партнёра в сервис. Пиннится форма запроса и то, что читается
 * ТОЛЬКО сам зритель (session.sub) — раньше это проверялось в pages.dashboard.*.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique } } }));

import { prisma } from '@/lib/db/prisma';
import { getWelcomeViewer } from '@/lib/services/welcome/viewer';

const session: SessionPayload = { sub: 'u1', role: 'organization', email: 'org@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getWelcomeViewer', () => {
  it('читает себя по session.sub, узкий select (имя + отметка «скрыт»)', async () => {
    findUnique.mockResolvedValue({ name: 'Иван', welcomeSeenAt: null });

    const viewer = await getWelcomeViewer(prisma, session);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { name: true, welcomeSeenAt: true },
    });
    expect(viewer).toEqual({ name: 'Иван', welcomeSeenAt: null });
  });

  it('пользователя нет (сессия пережила удаление) → null', async () => {
    findUnique.mockResolvedValue(null);

    expect(await getWelcomeViewer(prisma, { sub: 'gone', role: 'partner' })).toBeNull();
  });
});
