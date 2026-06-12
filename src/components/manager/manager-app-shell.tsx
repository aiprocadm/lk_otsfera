import type { ReactNode } from 'react';
import type { SessionPayload } from '@/lib/auth/jwt';
import { ManagerSidebar } from './manager-sidebar';
import { LogoutButton } from '@/components/ui';

export function ManagerAppShell(props: {
  session: SessionPayload;
  children: ReactNode;
}) {
  const userEmail = props.session.email ?? null;
  return (
    <div className='flex min-h-screen bg-gray-50'>
      <ManagerSidebar />
      <div className='flex-1 flex flex-col'>
        <header className='bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between'>
          <div className='text-sm text-gray-700 truncate'>
            <span className='font-medium text-[#111111]'>Кабинет менеджера</span>
            {userEmail ? (
              <span className='ml-3 text-gray-500'>· {userEmail}</span>
            ) : null}
          </div>
          <LogoutButton />
        </header>
        <main className='flex-1 px-6 py-6'>
          <div className='max-w-[1280px] mx-auto'>{props.children}</div>
        </main>
      </div>
    </div>
  );
}
