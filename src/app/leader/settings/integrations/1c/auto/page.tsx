import type { Metadata } from 'next';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { OneCAutoExchange } from '@/components/settings/one-c-auto-exchange';

export const metadata: Metadata = { title: 'Автообмен · Обмен с 1С' };

export const dynamic = 'force-dynamic';

/**
 * «Автообмен» руководителя (`У-118`, дефект `Д-33`). Вкладка была видна, но
 * вела на «страница не найдена»: при вставшем обмене руководитель не мог ни
 * посмотреть состояние, ни запустить обмен руками. Экран тот же, что у админа;
 * пауза расписания и перемотка курсора остаются админскими — они платформенные.
 */
export default async function LeaderSyncPage() {
  const session = await requireSettingsSection('integrations.oneC', 'leader');
  return OneCAutoExchange({ session, cabinet: 'leader' });
}
