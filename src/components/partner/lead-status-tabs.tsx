import React from 'react';
import Link from 'next/link';
import type { LeadStatus } from '@prisma/client';
import { leadStatusLabel } from './lead-status-badge';

const TABS: LeadStatus[] = ['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'];

export function LeadStatusTabs({
  active,
  countsByStatus,
  search
}: {
  active: LeadStatus | undefined;
  countsByStatus: Partial<Record<LeadStatus, number>>;
  search?: string;
}) {
  const total = TABS.reduce((sum, t) => sum + (countsByStatus[t] ?? 0), 0);

  function href(status?: LeadStatus): string {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    return `/partner/leads${params.toString() ? '?' + params.toString() : ''}`;
  }

  return (
    <nav className='flex flex-wrap gap-1.5 overflow-x-auto'>
      <Chip href={href()} active={!active} label='Все' count={total} />
      {TABS.map((s) => (
        <Chip
          key={s}
          href={href(s)}
          active={active === s}
          label={leadStatusLabel(s)}
          count={countsByStatus[s] ?? 0}
        />
      ))}
    </nav>
  );
}

function Chip({
  href,
  label,
  count,
  active
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-colors ${
        active
          ? 'bg-[#F97316] text-white border-[#F97316]'
          : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
      }`}
    >
      {label} <span className={active ? 'text-white/80' : 'text-gray-400'}>{count}</span>
    </Link>
  );
}
