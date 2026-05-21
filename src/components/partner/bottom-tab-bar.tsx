'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; icon: string; disabled?: boolean };

const TABS: Tab[] = [
  { href: '/partner/dashboard', label: 'Кабинет', icon: '⌂' },
  { href: '/partner/portfolio', label: 'Портфель', icon: '🏢' },
  { href: '/partner/team', label: 'Команда', icon: '👥' },
  { href: '/partner/deals', label: 'Сделки', icon: '📋', disabled: true }
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label='Mobile navigation'
      className='fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 grid grid-cols-4 md:hidden'
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const className = `flex flex-col items-center justify-center gap-0.5 h-14 text-xs font-medium ${
          tab.disabled
            ? 'text-gray-300 cursor-not-allowed'
            : active
            ? 'text-[#F97316]'
            : 'text-gray-600 active:bg-[#FFF7ED]'
        }`;

        if (tab.disabled) {
          return (
            <div key={tab.href} className={className} aria-disabled='true'>
              <span className='text-lg leading-none'>{tab.icon}</span>
              {tab.label}
            </div>
          );
        }
        return (
          <Link key={tab.href} href={tab.href} className={className}>
            <span className='text-lg leading-none'>{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
