import type { Metadata } from 'next';
import { StaffPersonalSettings } from '@/components/settings/staff-personal-settings';

export const metadata: Metadata = { title: 'Личные настройки · Настройки' };

/**
 * `У-114`: «Каналы уведомлений» и «Личная безопасность» слиты в один раздел с
 * теми же вкладками, что у менеджера, партнёра и заказчика. Вся начинка — в
 * общем серверном компоненте, страница только выбирает кабинет.
 */
export default async function AdminPersonalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Вызываем как функцию, а не как <тег>: вложенный async-компонент
  // так же корректен для сервера и при этом рендерится в тестах.
  return StaffPersonalSettings({ cabinet: 'admin', searchParams });
}
