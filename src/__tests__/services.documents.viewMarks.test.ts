import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 3 PR-2 (ФТ-6.6): отметки просмотра документов — upsert one row per
 * (document, user); best-effort (сбой не роняет скачивание); выборка Set.
 */

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn, error: vi.fn(), info: vi.fn() } }));

import { markDocumentViewed, viewedDocumentIds } from '@/lib/services/documents/viewMarks';

const prisma = {
  documentViewMark: { upsert: vi.fn(), findMany: vi.fn() }
} as never as import('@prisma/client').PrismaClient;

const mocked = prisma as unknown as {
  documentViewMark: { upsert: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markDocumentViewed', () => {
  it('upsert по составному ключу: create при первом просмотре, update viewedAt при повторном', async () => {
    mocked.documentViewMark.upsert.mockResolvedValue({});
    await markDocumentViewed(prisma, { documentId: 'd1', userId: 'u1' });
    expect(mocked.documentViewMark.upsert).toHaveBeenCalledWith({
      where: { documentId_userId: { documentId: 'd1', userId: 'u1' } },
      create: { documentId: 'd1', userId: 'u1' },
      update: { viewedAt: expect.any(Date) }
    });
  });

  it('best-effort: сбой БД проглатывается с log.warn (скачивание не ломается)', async () => {
    mocked.documentViewMark.upsert.mockRejectedValue(new Error('db down'));
    await expect(markDocumentViewed(prisma, { documentId: 'd1', userId: 'u1' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      '[documents/viewMarks] mark failed',
      expect.objectContaining({ documentId: 'd1', error: 'db down' })
    );
  });

  it('не-Error сбой тоже логируется строкой (String(err) ветка)', async () => {
    mocked.documentViewMark.upsert.mockRejectedValue('boom');
    await markDocumentViewed(prisma, { documentId: 'd2', userId: 'u1' });
    expect(warn).toHaveBeenCalledWith(
      '[documents/viewMarks] mark failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

describe('viewedDocumentIds', () => {
  it('пустой список id → пустой Set без запроса', async () => {
    const res = await viewedDocumentIds(prisma, { userId: 'u1', documentIds: [] });
    expect(res.size).toBe(0);
    expect(mocked.documentViewMark.findMany).not.toHaveBeenCalled();
  });

  it('возвращает Set просмотренных id по (userId, in documentIds)', async () => {
    mocked.documentViewMark.findMany.mockResolvedValue([{ documentId: 'a' }, { documentId: 'c' }]);
    const res = await viewedDocumentIds(prisma, { userId: 'u1', documentIds: ['a', 'b', 'c'] });
    expect(mocked.documentViewMark.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', documentId: { in: ['a', 'b', 'c'] } },
      select: { documentId: true }
    });
    expect(res.has('a')).toBe(true);
    expect(res.has('b')).toBe(false);
    expect(res.has('c')).toBe(true);
  });
});
