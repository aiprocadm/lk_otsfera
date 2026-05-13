import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { AppShell } from '@/components/dashboard/app-shell';
import { StatCard } from '@/components/dashboard/stat-card';

export default async function OrganizationDashboard() {
  const session = await getSession();
  if (!session?.companyId) return null;

  const [orders, documents, employees, education, notifications] = await Promise.all([
    prisma.order.count({ where: { companyId: session.companyId } }),
    prisma.document.count({ where: { order: { companyId: session.companyId } } }),
    prisma.user.count({ where: { companyId: session.companyId } }),
    prisma.student.count({ where: { organization: { companyId: session.companyId } } }),
    prisma.notification.count({ where: { organizationId: session.organizationId ?? undefined, isRead: false } })
  ]);

  return <AppShell><h1 className='mb-4 text-2xl font-semibold'>Кабинет организации</h1><div className='grid gap-3 md:grid-cols-5'><StatCard title='Заказы' value={orders}/><StatCard title='Документы' value={documents}/><StatCard title='Сотрудники' value={employees}/><StatCard title='Обучение' value={education}/><StatCard title='Новые уведомления' value={notifications}/></div></AppShell>;
}
