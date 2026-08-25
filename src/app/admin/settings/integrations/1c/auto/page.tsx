import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { OneCAutoExchange } from '@/components/settings/one-c-auto-exchange';

export const metadata: Metadata = { title: 'Автообмен · Обмен с 1С' };

export const dynamic = 'force-dynamic';

/** «Автообмен» администратора. Экран общий с кабинетом руководителя (`У-118`). */
export default async function AdminSyncPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');
  return OneCAutoExchange({ session, cabinet: 'admin' });
}
