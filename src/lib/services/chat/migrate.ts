import type { PrismaClient, ThreadSide } from '@prisma/client';

export type MigrateResult = { migrated: number; skipped: number };

/**
 * One-time backfill: copy each Comment into a Message in the (order, side) thread.
 * Side derives from the author's role; manager/admin comments inherit the side of
 * the nearest preceding external comment on the same order (fallback 'org').
 * Idempotent: skips comments already migrated (matched by thread+author+body+createdAt).
 * Migration runs without a session — it does a DIRECT orderThread upsert (no canSeeThread).
 */
export async function migrateCommentsToMessages(prisma: PrismaClient): Promise<MigrateResult> {
  const comments = await prisma.comment.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderId: true,
      authorId: true,
      body: true,
      attachmentPath: true,
      createdAt: true,
      author: { select: { role: true } }
    }
  });

  const lastExternalSide = new Map<string, ThreadSide>();
  let migrated = 0;
  let skipped = 0;

  for (const c of comments) {
    let side: ThreadSide;
    if (c.author.role === 'organization') side = 'org';
    else if (c.author.role === 'partner') side = 'partner';
    else side = lastExternalSide.get(c.orderId) ?? 'org';

    if (c.author.role === 'organization' || c.author.role === 'partner') {
      lastExternalSide.set(c.orderId, side);
    }

    const thread = await prisma.orderThread.upsert({
      where: { orderId_side: { orderId: c.orderId, side } },
      update: {},
      create: { orderId: c.orderId, side, lastMessageAt: c.createdAt }
    });

    const existing = await prisma.message.findFirst({
      where: {
        threadId: thread.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt
      },
      select: { id: true }
    });
    if (existing) {
      skipped++;
      continue;
    }

    await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: c.authorId,
        body: c.body,
        attachmentPath: c.attachmentPath,
        createdAt: c.createdAt
      }
    });

    // Ascending order → the last write per thread leaves lastMessageAt at the latest comment.
    await prisma.orderThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: c.createdAt }
    });

    migrated++;
  }

  return { migrated, skipped };
}
