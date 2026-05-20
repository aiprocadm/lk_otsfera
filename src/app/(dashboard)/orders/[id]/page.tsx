import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canReadOrder } from '@/lib/auth/policy';

export default async function OrderDetails({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { comments: { include: { author: true } }, documents: true, manager: true }
  });

  if (!order) redirect('/not-found');

  const canRead = await canReadOrder(session, order);
  if (!canRead) redirect('/forbidden');

  return (
    <main className='p-6 space-y-3'>
      <h1 className='text-2xl font-semibold'>{order.title}</h1>
      <p>Статус: {order.status}</p>
      <p>Дедлайн: {order.deadline?.toISOString().slice(0, 10) ?? '—'}</p>
      {order.manager && <p>Менеджер: {order.manager.name}</p>}
      <section>
        <h2 className='text-lg font-medium mt-4 mb-2'>Комментарии</h2>
        {order.comments.length === 0 ? (
          <p className='text-slate-500 text-sm'>Комментариев пока нет</p>
        ) : (
          <div className='space-y-2'>
            {order.comments.map((c) => (
              <div key={c.id} className='border rounded p-3'>
                <p className='text-sm font-medium'>{c.author.name}</p>
                <p className='text-sm'>{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
