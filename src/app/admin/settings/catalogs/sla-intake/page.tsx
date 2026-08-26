import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { SlaIntakeScreen } from '@/components/settings/sla-intake-screen';

export const metadata: Metadata = { title: 'SLA входящих в работу · Настройки' };

export const dynamic = 'force-dynamic';

/** `У-130`: администратор видит пороги всех компаний и правит расписание задачи. */
export default async function AdminSlaIntakePage() {
  const session = await requireSettingsSection('catalogs.slaIntake', 'admin');
  return SlaIntakeScreen({ session, cabinet: 'admin' });
}
