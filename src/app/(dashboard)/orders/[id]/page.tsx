import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canReadOrder } from '@/lib/auth/policy';

const statusLabel: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting_client: 'Ожидает клиента',
  completed: 'Завершён',
};

const statusColor: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-[#FFF7ED] text-[#F97316] border-orange-200',
  waiting_client: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
};

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
    <div className='space-y-6 max-w-4xl'>
      {/* Header */}
      <div className='flex items-start justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>{order.title}</h1>
          <div className='flex items-center gap-3 mt-2'>
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${statusColor[order.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {statusLabel[order.status] ?? order.status}
            </span>
            {order.deadline && (
              <span className='text-sm text-gray-500'>Дедлайн: {order.deadline.toLocaleDateString('ru-RU')}</span>
            )}
          </div>
        </div>
        {order.manager && (
          <div className='text-right text-sm text-gray-500'>
            <div className='text-xs text-gray-400 mb-0.5'>Менеджер</div>
            <div className='font-medium text-[#111111]'>{order.manager.name}</div>
          </div>
        )}
      </div>

      {/* Documents */}
      {order.documents.length > 0 && (
        <div className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm'>
          <h2 className='font-semibold text-[#111111] mb-3 flex items-center gap-2'>
            <span className='w-5 h-5 bg-[#F97316] rounded flex items-center justify-center text-white text-xs'>D</span>
            Документы ({order.documents.length})
          </h2>
          <div className='space-y-2'>
            {order.documents.map((doc) => (
              <div key={doc.id} className='flex items-center gap-3 text-sm text-gray-600 py-1.5 border-b border-gray-50 last:border-0'>
                <span className='text-gray-400'>📄</span>
                {doc.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm'>
        <h2 className='font-semibold text-[#111111] mb-4 flex items-center gap-2'>
          <span className='w-5 h-5 bg-[#111111] rounded flex items-center justify-center text-white text-xs'>C</span>
          Комментарии ({order.comments.length})
        </h2>
        {order.comments.length === 0 ? (
          <p className='text-gray-400 text-sm text-center py-6'>Комментариев пока нет</p>
        ) : (
          <div className='space-y-3'>
            {order.comments.map((c) => (
              <div key={c.id} className='flex gap-3'>
                <div className='w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-bold flex-shrink-0'>
                  {c.author.name.charAt(0).toUpperCase()}
                </div>
                <div className='flex-1 bg-gray-50 rounded-lg px-4 py-3'>
                  <div className='text-xs font-semibold text-[#111111] mb-1'>{c.author.name}</div>
                  <p className='text-sm text-gray-700'>{c.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
