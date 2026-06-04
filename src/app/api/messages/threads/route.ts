import { requireSession } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listThreads } from '@/lib/services/chat/threads';

export async function GET() {
  const off = notFoundIfDisabled('chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;

  const result = await listThreads(prisma, sess.value);
  return Response.json(result);
}
