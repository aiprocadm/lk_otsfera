import { AppShell } from '@/components/dashboard/app-shell';

/**
 * Этап 3 (`У-16`, `У-17`): отдельной нижней панели у партнёра больше нет —
 * она общая и монтируется из шелла вместе с бургером. Отступ `pb-16 md:pb-0`
 * тоже уехал в шелл: раньше он был продублирован здесь и там.
 */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
