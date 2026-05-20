import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

const statusLabel: Record<string, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting_client: 'Ожидает клиента',
  completed: 'Завершён',
};

const statusColor: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-[#FFF7ED] text-[#F97316]',
  waiting_client: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
};

export default async function Orders() {
  const session = await getSession();
  if (!session) redirect('/login');

  const where =
    session.role === 'admin'
      ? {}
      : session.role === 'organization' && session.organizationId
        ? { company: { organizations: { some: { id: session.organizationId } } } }
        : session.role === 'partner' && session.partnerId
          ? { company: { organizations: { some: { partnerId: session.partnerId } } } }
          : { company: { organizations: { some: { organizationUsers: { some: { userId: session.sub, isActive: true } } } } } };

  const orders = await prisma.order.findMany({
    where,
    include: { manager: true },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Заказы</h1>
          <p className='text-gray-500 text-sm mt-0.5'>{orders.length} {orders.length === 1 ? 'заказ' : orders.length < 5 ? 'заказа' : 'заказов'}</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
          <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
            <span className='text-2xl'>📋</span>
          </div>
          <p className='text-gray-500 text-sm'>Заказов пока нет</p>
        </div>
      ) : (
        <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-gray-100 bg-gray-50'>
                <th className='text-left px-5 py-3 font-medium text-gray-600'>Заказ</th>
                <th className='text-left px-5 py-3 font-medium text-gray-600'>Статус</th>
                <th className='text-left px-5 py-3 font-medium text-gray-600'>Менеджер</th>
                <th className='text-left px-5 py-3 font-medium text-gray-600'>Дата</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.id} className={`border-b border-gray-50 hover:bg-[#FFF7ED] transition-colors ${i === orders.length - 1 ? 'border-b-0' : ''}`}>
                  <td className='px-5 py-3.5'>
                    <Link href={`/orders/${o.id}`} className='font-medium text-[#111111] hover:text-[#F97316] transition-colors'>
                      {o.title}
                    </Link>
                  </td>
                  <td className='px-5 py-3.5'>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {statusLabel[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className='px-5 py-3.5 text-gray-600'>{o.manager?.name ?? '—'}</td>
                  <td className='px-5 py-3.5 text-gray-500'>{o.createdAt.toLocaleDateString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
