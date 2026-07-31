import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';

/**
 * Отметки просмотра документов (этап 3 PR-2, ФТ-6.6): бейдж «новый» в
 * клиентских списках гаснет после скачивания. `markDocumentViewed` —
 * best-effort (§3): сбой отметки логируется и НЕ ломает скачивание.
 */

export async function markDocumentViewed(
  prisma: PrismaClient,
  args: { documentId: string; userId: string }
): Promise<void> {
  try {
    await prisma.documentViewMark.upsert({
      where: { documentId_userId: { documentId: args.documentId, userId: args.userId } },
      create: { documentId: args.documentId, userId: args.userId },
      update: { viewedAt: new Date() },
    });
  } catch (err) {
    log.warn('[documents/viewMarks] mark failed', {
      documentId: args.documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** id документов из `documentIds`, которые пользователь уже видел. */
export async function viewedDocumentIds(
  prisma: PrismaClient,
  args: { userId: string; documentIds: string[] }
): Promise<Set<string>> {
  if (!args.documentIds.length) return new Set();
  const rows = await prisma.documentViewMark.findMany({
    where: { userId: args.userId, documentId: { in: args.documentIds } },
    select: { documentId: true },
  });
  return new Set(rows.map((r) => r.documentId));
}
