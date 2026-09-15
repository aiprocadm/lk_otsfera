import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listAutomationRules, listAutomationRuns } from '@/lib/services/automation/rules';
import { AutomationScreen } from '@/components/automation/automation-screen';

export const metadata: Metadata = { title: 'Автоматизация · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Автоматизация» руководителя (`У-222`): правила своей компании.
 *
 * Компания берётся из сессии, а не из адреса: иначе руководитель одной компании
 * читал бы чужие правила, поменяв строку в браузере. База — здесь, в слое app
 * (`components-no-db`), экран презентационный.
 */
export default async function LeaderAutomationPage() {
  const session = await requireSettingsSection('catalogs.automation', 'leader');
  const companyId = session.companyId ?? null;

  const [rules, runs] = companyId
    ? await Promise.all([
        listAutomationRules(prisma, companyId),
        listAutomationRuns(prisma, companyId),
      ])
    : [[], []];

  return (
    <AutomationScreen
      cabinet="leader"
      companyId={companyId}
      companies={[]}
      rules={rules}
      runs={runs}
    />
  );
}
