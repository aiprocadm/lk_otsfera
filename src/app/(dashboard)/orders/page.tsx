import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

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
    <main className='p-6'>
      <h1 className='text-xl font-semibold mb-3'>Заказы</h1>
      {orders.length === 0 ? (
        <p className='text-slate-500 text-sm'>Заказов пока нет</p>
      ) : (
        <div className='space-y-2'>
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className='block border p-3 rounded hover:bg-slate-50'
            >
              {o.title} — {o.status}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
