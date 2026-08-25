import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/app-shell';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { getSession } from '@/lib/auth/session';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';

import { PageHeader } from '@/components/ui/page-header';
const CONTENT = (
  <>
    <PageHeader
      title="Кабинет слушателя"
      subtitle="Обучение проходит на отдельной учебной площадке. Нажмите кнопку — вход выполнится автоматически, отдельный пароль не понадобится."
    />
    <Link
      href="/student/redirect"
      className="inline-block rounded-lg bg-[#F97316] hover:bg-[#EA580C] text-white px-4 py-2 text-sm font-semibold transition-colors"
    >
      Перейти к обучению
    </Link>
  </>
);

export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await getSession();

  // Орг-пользователь должен остаться в родной оболочке организации,
  // а не выпадать в generic-шелл с другой шапкой и меню.
  if (session?.role === 'organization') {
    const ctx = await getOrgPageContext(await searchParams);
    return (
      <OrgAppShell
        userEmail={ctx.session.email}
        activeOrgName={ctx.activeOrgName}
        memberships={ctx.memberships}
        activeOrgId={ctx.activeOrgId}
        viewerRole={ctx.viewerRole}
      >
        {CONTENT}
      </OrgAppShell>
    );
  }

  return <AppShell>{CONTENT}</AppShell>;
}
