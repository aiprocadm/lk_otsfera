import type { ReactNode } from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { ManagerAppShell } from '@/components/manager/manager-app-shell';

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const session = await requireManager();
  return <ManagerAppShell session={session}>{children}</ManagerAppShell>;
}
