import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { kpis, attention, recentEvents } from '@/lib/services/admin/dashboard';
import { auditActionRu } from '@/lib/i18n/auditActions';
import { StatCard } from '@/components/dashboard/stat-card';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireAdmin();

  const [k, a, events] = await Promise.all([
    kpis(prisma),
    attention(prisma),
    recentEvents(prisma, 20),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Кабинет администратора</h1>
        <p className="text-sm text-gray-500 mt-0.5">Обзор платформы</p>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {k.map((tile) => (
          <StatCard key={tile.label} title={tile.label} value={tile.value} href={tile.href} />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Attention List */}
        {a.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
            Всё под контролем — нет проблем, требующих внимания.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#111111] mb-3">Требует внимания</h2>
            <ul className="space-y-2 text-sm">
              {a.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={item.href}
                    className={`flex-1 min-w-0 truncate hover:underline ${
                      item.severity === 'urgent'
                        ? 'text-red-700'
                        : 'text-gray-700 hover:text-[#F97316]'
                    }`}
                  >
                    {item.severity === 'urgent' ? '⚠ ' : '🕒 '}
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Events Feed */}
        {events.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
            Пока тут пусто — события появятся когда начнётся работа.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#111111] mb-3">Последние события</h2>
            <ul className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin/audit?entity=${e.entity}&action=${e.verb}`}
                    className="text-gray-700 flex-1 min-w-0 truncate hover:text-[#F97316] hover:underline"
                  >
                    <span className="font-medium">{e.actor}</span> {auditActionRu(e.verb)}
                  </Link>
                  <span className="text-gray-400 text-xs whitespace-nowrap">
                    {fmtDateTime(e.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
