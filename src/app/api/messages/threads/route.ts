import { withAuth } from '@/lib/api/withAuth';
import { prisma } from '@/lib/db/prisma';
import { listThreads } from '@/lib/services/chat/threads';

export const GET = withAuth({ feature: 'chat' }, async ({ session }) => {
  const result = await listThreads(prisma, session);
  return Response.json(result);
});
