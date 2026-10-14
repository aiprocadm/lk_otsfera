import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/dashboard/app-shell';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { getSession } from '@/lib/auth/session';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { prisma } from '@/lib/db/prisma';
import { getStudentCabinet } from '@/lib/services/students/cabinet';
import { StudentTrainingsList } from '@/components/student/student-trainings';

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
        activeOrgName={ctx.activeOrgName}
        memberships={ctx.memberships}
        activeOrgId={ctx.activeOrgId}
        viewerRole={ctx.viewerRole}
      >
        {CONTENT}
      </OrgAppShell>
    );
  }

  // Этап 2 ТЗ 13.10.2026 (`У-285`): у слушателя главная — не одна кнопка, а
  // «Мои обучения». Скоуп режет сервис (свои карточки), чужого здесь нет.
  const cabinet = session ? await getStudentCabinet(prisma, session) : null;
  return (
    <AppShell>
      {CONTENT}
      {cabinet?.ok && (
        <section className="mt-6 space-y-3" aria-labelledby="my-trainings">
          <h2 id="my-trainings" className="text-base font-semibold text-[#111111]">
            Мои обучения
          </h2>
          <StudentTrainingsList trainings={cabinet.cabinet.trainings} />
        </section>
      )}
    </AppShell>
  );
}
