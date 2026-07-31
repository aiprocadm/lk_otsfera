import { withAuth } from '@/lib/api/withAuth';
import { prisma } from '@/lib/db/prisma';
import { unreadCount } from '@/lib/services/chat/threads';

export const GET = withAuth({ feature: 'chat' }, async ({ session }) => {
  const result = await unreadCount(prisma, session);
  return Response.json(result);
});
