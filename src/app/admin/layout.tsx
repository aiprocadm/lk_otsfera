import type { ReactNode } from 'react';
import { AdminAppShell } from '@/components/admin/admin-app-shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminAppShell>{children}</AdminAppShell>;
}
