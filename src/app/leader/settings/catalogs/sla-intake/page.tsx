import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listCompaniesSla } from '@/lib/services/manager/slaSettings';
import { SlaIntakeScreen } from '@/components/settings/sla-intake-screen';

export const metadata: Metadata = { title: 'SLA входящих в работу · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * `У-130`: руководитель правит пороги своей компании. Экран тот же; скоуп
 * держит сервис `listCompaniesSla`, а не видимость экрана. База — здесь, в
 * слое app: компонент презентационный (`components-no-db`).
 */
export default async function LeaderSlaIntakePage() {
  const session = await requireSettingsSection('catalogs.slaIntake', 'leader');
  const companies = await listCompaniesSla(prisma, session);

  return (
    <SlaIntakeScreen
      cabinet="leader"
      hasCompany={Boolean(session.companyId)}
      companies={companies.ok ? companies.companies : []}
      // Расписание задачи — платформенное, его видит только администратор.
      patterns={new Map()}
    />
  );
}
