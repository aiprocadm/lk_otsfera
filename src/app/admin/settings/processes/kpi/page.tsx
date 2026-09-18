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
 * «Показатели и планы» администратора (`У-242`, этап 7). Месяц берётся из
 * адреса (`?month=YYYY-MM`), по умолчанию — текущий по Москве. База — здесь, в
 * слое app (`components-no-db`); экран презентационный.
 */
export default async function AdminKpiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireSettingsSection('catalogs.kpi', 'admin');
  const sp = await searchParams;
  const { year, month } = parseKpiMonth(sp.month);
  const res = await getKpiSettings(prisma, session, { year, month });
  if (!res.ok) notFound();
  return <KpiSettingsScreen view={res.view} />;
}
