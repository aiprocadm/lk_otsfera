import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { listAutomationRules, listAutomationRuns } from '@/lib/services/automation/rules';
import { AutomationScreen } from '@/components/automation/automation-screen';

export const metadata: Metadata = { title: 'Автоматизация · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Автоматизация» администратора (`У-222`) — зеркало экрана руководителя с
 * одним отличием: компанию надо ВЫБРАТЬ.
 *
 * Платформенных правил здесь нет намеренно (в отличие от правил уведомлений,
 * где `companyId = null` означает «правило платформы»). Робот, создающий задачи
 * сразу во всех компаниях, — не функция, а происшествие: администратор правит
 * правила конкретной компании, как если бы он был её руководителем.
 */
export default async function AdminAutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSettingsSection('catalogs.automation', 'admin');
  const sp = await searchParams;
  const selected = typeof sp.companyId === 'string' ? sp.companyId : null;

  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  // Выбор из адреса проверяется по списку: чужая строка не должна показывать
  // пустой экран «правил нет», как будто у компании их действительно нет.
  const companyId = companies.some((c) => c.id === selected) ? selected : null;

  const [rules, runs] = companyId
    ? await Promise.all([
        listAutomationRules(prisma, companyId),
        listAutomationRuns(prisma, companyId),
      ])
    : [[], []];

  return (
    <AutomationScreen
      cabinet="admin"
      companyId={companyId}
      companies={companies}
      rules={rules}
      runs={runs}
    />
  );
}
