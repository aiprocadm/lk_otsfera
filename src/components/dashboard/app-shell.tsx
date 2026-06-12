import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { isManagerLeader } from '@/lib/auth/managerPolicy';
import { LogoutButton } from '@/components/ui';

const roleLabel: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация',
  student: 'Студент',
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className='min-h-screen bg-gray-50 flex flex-col'>
      {/* Header */}
      <header className='bg-[#111111] text-white px-6 py-0 flex items-center justify-between h-14 shadow-lg flex-shrink-0'>
        <div className='flex items-center gap-3'>
          <span className='w-8 h-8 rounded-md bg-[#F97316] flex items-center justify-center font-black text-white text-sm'>О</span>
          <span className='font-semibold tracking-wide text-sm uppercase'>ОТСФЕРА</span>
        </div>
        <div className='flex items-center gap-3'>
          <div className='text-right'>
            <div className='text-xs text-gray-400'>{roleLabel[session.role] ?? session.role}</div>
            <div className='text-sm font-medium'>{session.name}</div>
          </div>
          <LogoutButton className='text-xs text-gray-400 hover:text-[#F97316] transition-colors px-2 py-1 border border-gray-700 rounded hover:border-[#F97316] disabled:opacity-60' />
        </div>
      </header>

      <div className='flex flex-1 overflow-hidden'>
        {/* Sidebar */}
        <aside className='w-56 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col'>
          <nav className='flex-1 p-3 space-y-0.5 overflow-y-auto'>
            {navItemsFor(session.role, { isManagerLeader: isManagerLeader(session), isPartnerAdmin: session.partnerRole === 'admin' }).map((item) =>
              item.disabled ? (
                <div
                  key={item.href}
                  className='flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed'
                  title='Доступно в следующей фазе'
                >
                  <span className='w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0' />
                  {item.label}
                  <span className='ml-auto text-[10px] uppercase tracking-wide text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded'>скоро</span>
                </div>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className='flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-[#FFF7ED] hover:text-[#F97316] transition-all group'
                >
                  <span className='w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-[#F97316] transition-colors flex-shrink-0' />
                  {item.label}
                </Link>
              )
            )}
          </nav>
          <div className='p-3 border-t border-gray-100'>
            <div className='text-xs text-gray-400 text-center'>ОТСФЕРА &copy; 2024</div>
          </div>
        </aside>

        {/* Content */}
        <main className='flex-1 overflow-auto p-6'>
          {children}
        </main>
      </div>
    </div>
  );
}
