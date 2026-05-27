import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listIncomingComments } from '@/lib/services/manager/messages';
import { ManagerMessagesInbox } from '@/components/manager/manager-messages-inbox';

type SearchParams = { cursor?: string };

export default async function ManagerMessagesPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const { rows, nextCursor } = await listIncomingComments(prisma, {
    session,
    withOutgoing: true,
    ...(sp.cursor ? { cursor: sp.cursor } : {})
  });
  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Сообщения</h1>
      <ManagerMessagesInbox rows={rows} nextCursor={nextCursor} />
    </>
  );
}
