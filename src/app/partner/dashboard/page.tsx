import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { AppShell } from '@/components/dashboard/app-shell';
import { StatCard } from '@/components/dashboard/stat-card';

export default async function PartnerDashboard() {
  const session = await getSession();
  if (!session?.partnerId) return null;

  const [organizationsCount, activeOrders, newDocuments, notifications] = await Promise.all([
    prisma.organization.count({ where: { partnerId: session.partnerId } }),
    prisma.order.count({ where: { company: { organizations: { some: { partnerId: session.partnerId } } }, status: { in: ['new', 'in_progress'] } } }),
    prisma.document.count({ where: { order: { company: { organizations: { some: { partnerId: session.partnerId } } } } } }),
    prisma.comment.findMany({ where: { order: { company: { organizations: { some: { partnerId: session.partnerId } } } } }, take: 5, orderBy: { createdAt: 'desc' } })
  ]);

  return <AppShell><h1 className='mb-4 text-2xl font-semibold'>Кабинет партнера</h1><div className='grid gap-3 md:grid-cols-4'><StatCard title='Организации' value={organizationsCount}/><StatCard title='Активные заказы' value={activeOrders}/><StatCard title='Документы' value={newDocuments}/><StatCard title='Уведомления' value={notifications.length}/></div></AppShell>;
}
