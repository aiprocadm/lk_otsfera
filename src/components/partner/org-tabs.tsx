import Link from 'next/link';

export type TabKey = 'employees' | 'comments' | 'history' | 'settings';

const ALL_TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: 'employees', label: 'Сотрудники' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки', adminOnly: true }
];

export function OrgTabs({
  orgId, active, isAdmin
}: { orgId: string; active: TabKey; isAdmin: boolean }) {
  const tabs = ALL_TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <nav className='border-b border-gray-200 flex gap-4 overflow-x-auto'>
      {tabs.map((t) => {
        const isActive = t.key === active;
        const href = t.key === 'settings'
          ? `/partner/portfolio/${orgId}/settings`
          : `/partner/portfolio/${orgId}?tab=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              isActive
                ? 'text-[#F97316] border-[#F97316]'
                : 'text-gray-600 border-transparent hover:text-[#111111]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
