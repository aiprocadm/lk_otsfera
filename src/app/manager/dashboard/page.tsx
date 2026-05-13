import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { StatCard } from '@/components/dashboard/stat-card';

export default async function ManagerDashboard() {
  const session = await getSession();
  if (!session) return null;

  const [activeOrders, pendingNotifications] = await Promise.all([
    prisma.order.count({ where: { managerId: session.sub, status: { in: ['new', 'in_progress'] } } }),
    prisma.notification.count({ where: { userId: session.sub, isRead: false } })
  ]);

  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Кабинет менеджера</h1>
      <div className='grid gap-3 md:grid-cols-2'>
        <StatCard title='Активные заказы' value={activeOrders} />
        <StatCard title='Новые уведомления' value={pendingNotifications} />
      </div>
    </>
  );
}
