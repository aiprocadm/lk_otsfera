import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { SlaIntakeScreen } from '@/components/settings/sla-intake-screen';

export const metadata: Metadata = { title: 'SLA входящих в работу · Настройки' };

export const dynamic = 'force-dynamic';

/** `У-130`: руководитель правит пороги своей компании. Экран тот же. */
export default async function LeaderSlaIntakePage() {
  const session = await requireSettingsSection('catalogs.slaIntake', 'leader');
  return SlaIntakeScreen({ session, cabinet: 'leader' });
}
