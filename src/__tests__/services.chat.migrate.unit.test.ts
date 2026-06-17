/**
 * Unit tests for src/lib/services/chat/migrate.ts
 * Covers the 'partner' side branch and skip/migrate counting.
 */
import { describe, it, expect, vi } from 'vitest';
import { migrateCommentsToMessages } from '@/lib/services/chat/migrate';

function makeComment(overrides: Record<string, any> = {}) {
  return {
    id: 'c1', orderId: 'o1', authorId: 'u1', body: 'Текст',
    attachmentPath: null, createdAt: new Date('2024-01-01'),
    author: { role: 'organization' },
    ...overrides
  };
}

function makePrisma(comments: object[], existingMsg: object | null = null) {
  const upsert = vi.fn().mockResolvedValue({ id: 'thread1' });
  const findFirst = vi.fn().mockResolvedValue(existingMsg);
  const create = vi.fn().mockResolvedValue({ id: 'msg1' });
  const update = vi.fn().mockResolvedValue({});
  return {
    comment: { findMany: vi.fn().mockResolvedValue(comments) },
    orderThread: { upsert, update },
    message: { findFirst, create },
    _upsert: upsert,
    _findFirst: findFirst,
    _create: create,
    _threadUpdate: update
  } as any;
}

describe('migrateCommentsToMessages — unit', () => {
  it('returns { migrated: 0, skipped: 0 } when no comments', async () => {
    const prisma = makePrisma([]);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 0, skipped: 0 });
  });

  it('migrates an org comment to side="org"', async () => {
    const prisma = makePrisma([makeComment({ author: { role: 'organization' } })]);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 1, skipped: 0 });
    const upsertCall = prisma._upsert.mock.calls[0][0];
    expect(upsertCall.where.orderId_side.side).toBe('org');
  });

  it('migrates a partner comment to side="partner"', async () => {
    const prisma = makePrisma([makeComment({ author: { role: 'partner' } })]);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 1, skipped: 0 });
    const upsertCall = prisma._upsert.mock.calls[0][0];
    expect(upsertCall.where.orderId_side.side).toBe('partner');
  });

  it('manager comment inherits last external side (defaults to "org" with no prior)', async () => {
    const prisma = makePrisma([makeComment({ author: { role: 'manager' } })]);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 1, skipped: 0 });
    const upsertCall = prisma._upsert.mock.calls[0][0];
    // No previous external comment → default 'org'
    expect(upsertCall.where.orderId_side.side).toBe('org');
  });

  it('manager comment inherits "partner" side when last external was partner', async () => {
    const comments = [
      makeComment({ id: 'c1', author: { role: 'partner' } }),
      makeComment({ id: 'c2', author: { role: 'manager' } })
    ];
    const prisma = makePrisma(comments);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 2, skipped: 0 });
    // second upsert (for manager) should use 'partner' side
    const secondUpsert = prisma._upsert.mock.calls[1][0];
    expect(secondUpsert.where.orderId_side.side).toBe('partner');
  });

  it('skips comments that are already migrated (idempotent)', async () => {
    const existing = { id: 'existing-msg' };
    const prisma = makePrisma([makeComment()], existing);
    const result = await migrateCommentsToMessages(prisma);
    expect(result).toEqual({ migrated: 0, skipped: 1 });
    expect(prisma._create).not.toHaveBeenCalled();
  });

  it('updates lastMessageAt on thread after migrating', async () => {
    const prisma = makePrisma([makeComment()]);
    await migrateCommentsToMessages(prisma);
    expect(prisma._threadUpdate).toHaveBeenCalled();
  });

  it('stores attachmentPath in message when present', async () => {
    const comment = makeComment({ attachmentPath: 'chat/o1/file.pdf' });
    const prisma = makePrisma([comment]);
    await migrateCommentsToMessages(prisma);
    const createData = prisma._create.mock.calls[0][0].data;
    expect(createData.attachmentPath).toBe('chat/o1/file.pdf');
  });
});
