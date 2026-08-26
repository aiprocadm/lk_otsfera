import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompaniesSla } from '@/lib/services/manager/slaSettings';
import { getSchedulePatterns } from '@/lib/services/admin/syncSchedules';
import { SlaIntakeScreen } from '@/components/settings/sla-intake-screen';

export const metadata: Metadata = { title: 'SLA входящих в работу · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * `У-130`: администратор видит пороги всех компаний и правит расписание задачи.
 * База — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function AdminSlaIntakePage() {
  const session = await requireSettingsSection('catalogs.slaIntake', 'admin');
  const [companies, patterns] = await Promise.all([
    listCompaniesSla(prisma, session),
    // `У-130`: интервал задачи SLA настраивается тем же механизмом, что
    // расписания обмена (`У-125`) — только администратором.
    getSchedulePatterns(prisma).catch(() => new Map<string, string>()),
  ]);

  return (
    <SlaIntakeScreen
      cabinet="admin"
      hasCompany
      companies={companies.ok ? companies.companies : []}
      patterns={patterns}
    />
  );
}
