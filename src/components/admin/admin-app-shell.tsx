import React, { type ReactNode } from 'react';
import { AdminSidebar } from './admin-sidebar';
import { requireAdmin } from '@/lib/auth/requireRole';
import { LogoutButton } from '@/components/ui';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { navItemsFor } from '@/lib/navigation/cabinet';

export async function AdminAppShell({ children }: { children: ReactNode }) {
  const session = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminSidebar items={navItemsFor('admin')} />
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-700">{session.email}</div>
          <div className="flex items-center gap-2">
            <NotificationBell role="admin" />
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 px-6 py-6">
          <div className="max-w-[1280px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
