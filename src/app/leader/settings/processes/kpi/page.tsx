import type { Metadata } from 'next';
import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getKpiSettings } from '@/lib/services/kpi/settings';
import { KpiSettingsScreen } from '@/components/kpi/kpi-settings-screen';
import { parseKpiMonth } from '@/lib/kpi/period';

export const metadata: Metadata = { title: 'Показатели и планы · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Показатели и планы» руководителя (`У-242`, этап 7) — тот же экран, что у
 * администратора (правило зеркала §0.2). Компания берётся из сессии: выбора
 * компании у руководителя нет и быть не должно.
 */
export default async function LeaderKpiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.kpi', 'leader');
  const sp = await searchParams;
  const { year, month } = parseKpiMonth(sp.month);
  const res = await getKpiSettings(prisma, session, { year, month });
  if (!res.ok) notFound();
  return <KpiSettingsScreen view={res.view} />;
}
