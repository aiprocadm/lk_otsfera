import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { navByRole } from '@/lib/navigation/cabinet';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className='min-h-screen bg-slate-50'>
      <header className='border-b bg-white px-6 py-3 flex items-center justify-between'>
        <div className='font-semibold'>LK MVP</div>
        <div className='text-sm text-slate-600'>{session.name} · {session.role}</div>
      </header>
      <div className='grid md:grid-cols-[240px_1fr]'>
        <aside className='border-r bg-white p-4'>
          <nav className='space-y-2'>
            {navByRole[session.role].map((item) => (
              <Link key={item.href} href={item.href} className='block rounded border p-2 hover:bg-slate-50'>
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className='p-6'>{children}</main>
      </div>
    </div>
  );
}
