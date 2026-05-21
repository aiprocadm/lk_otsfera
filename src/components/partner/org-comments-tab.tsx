import { prisma } from '@/lib/db/prisma';

export async function CommentsTab({ orgId }: { orgId: string }) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { companyId: true }
  });
  if (!org?.companyId) {
    return <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>Нет данных.</div>;
  }

  const comments = await prisma.comment.findMany({
    where: { order: { companyId: org.companyId } },
    include: {
      author: { select: { name: true } },
      order: { select: { id: true, title: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  if (comments.length === 0) {
    return <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>Комментариев нет.</div>;
  }

  return (
    <ul className='space-y-2'>
      {comments.map((c) => (
        <li key={c.id} className='bg-white border border-gray-200 rounded-xl p-4'>
          <div className='flex justify-between text-xs text-gray-500 mb-1'>
            <span>{c.author.name} · «{c.order.title}»</span>
            <span>{c.createdAt.toLocaleString('ru-RU')}</span>
          </div>
          <div className='text-sm text-[#111111] whitespace-pre-wrap'>{c.body}</div>
        </li>
      ))}
    </ul>
  );
}
