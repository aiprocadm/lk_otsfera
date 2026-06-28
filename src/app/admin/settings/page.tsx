import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getTelegramStatus } from '@/lib/services/telegram/link';
import { TelegramLinkCard } from '@/components/settings/telegram-link-card';

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  const status = await getTelegramStatus(prisma, session);

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-bold text-[#111111]'>Настройки</h1>
      <TelegramLinkCard status={status} />
    </div>
  );
}
