import { LoginForm, type DemoLogin } from '@/components/auth/login-form';

// Демо-доступ читается из server-only env на каждый запрос (не на build-time),
// чтобы оператор мог включить его на dev/staging без пересборки. В проде флаг
// выключен — учётные данные никогда не попадают в клиентский бандл.
export const dynamic = 'force-dynamic';

const DEMO_LOGINS: DemoLogin[] = [
  { label: 'Админ', email: 'admin@demo.local', password: 'Password123!' },
  { label: 'Партнёр (админ)', email: 'partner@demo.local', password: 'Password123!' },
  { label: 'Партнёр (менеджер)', email: 'partner-mgr@demo.local', password: 'Password123!' },
  { label: 'Организация', email: 'org@demo.local', password: 'Password123!' },
  { label: 'Менеджер', email: 'manager@demo.local', password: 'Password123!' },
  { label: 'Руководитель', email: 'leader@demo.local', password: 'Password123!' },
  { label: 'Студент', email: 'student@demo.local', password: 'Password123!' }
];

function demoLoginsEnabled(): boolean {
  const raw = (process.env.SHOW_DEMO_LOGINS ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes', 'enabled'].includes(raw);
}

export default function LoginPage() {
  const demoLogins = demoLoginsEnabled() ? DEMO_LOGINS : undefined;

  return (
    <main className='min-h-screen flex'>
      {/* Left panel — brand */}
      <div className='hidden lg:flex flex-col justify-between w-1/2 bg-[#111111] p-12 text-white'>
        <div className='flex items-center gap-3'>
          <span className='w-10 h-10 rounded-lg bg-[#F97316] flex items-center justify-center font-black text-white text-lg'>П</span>
          <span className='font-bold text-lg tracking-widest'>Промтехносфера</span>
        </div>
        <div className='space-y-4'>
          <h1 className='text-4xl font-bold leading-tight'>
            Личный кабинет<br />
            <span className='text-[#F97316]'>B2B платформы</span>
          </h1>
          <p className='text-gray-400 text-lg'>Управление заказами, документами и командой в одном месте.</p>
        </div>
        <div className='text-gray-600 text-sm'>© 2026 Промтехносфера. Все права защищены.</div>
      </div>

      {/* Right panel — form */}
      <div className='flex-1 flex items-center justify-center p-8 bg-gray-50'>
        <div className='w-full max-w-md'>
          {/* Mobile logo */}
          <div className='flex items-center gap-2 mb-8 lg:hidden'>
            <span className='w-8 h-8 rounded-md bg-[#F97316] flex items-center justify-center font-black text-white text-sm'>П</span>
            <span className='font-bold tracking-widest text-[#111111]'>Промтехносфера</span>
          </div>

          <LoginForm demoLogins={demoLogins} />
        </div>
      </div>
    </main>
  );
}
