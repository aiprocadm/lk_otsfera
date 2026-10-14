import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/dashboard/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui';
import { StudentCertificatesList, trainingDates } from '@/components/student/student-trainings';
import { requireSession } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getStudentCabinet } from '@/lib/services/students/cabinet';

export const metadata: Metadata = { title: 'Мой профиль' };
export const dynamic = 'force-dynamic';

const CARD = 'bg-white border border-gray-200 rounded-xl p-5 space-y-3';

/**
 * «Мой профиль» слушателя (`У-284`, этап 2 ТЗ 13.10.2026): ФИО, организация,
 * назначенные обучения со сроками и удостоверения с датой окончания.
 *
 * Гард — сервис: кабинет отдаётся только роли `student`, остальным (в том числе
 * пользователю организации, которого `/student` пускает как shared-entry) —
 * 404, пункта «Мой профиль» в их меню нет.
 */
export default async function StudentProfilePage() {
  const session = await requireSession();
  const r = await getStudentCabinet(prisma, session);
  if (!r.ok) notFound();
  const { cabinet } = r;
  const linked = cabinet.organizations.length > 0;

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeader
          title="Мой профиль"
          subtitle="Ваши данные, назначенные обучения со сроками и удостоверения."
        />

        <section className={CARD} aria-labelledby="about-me">
          <h2 id="about-me" className="font-semibold text-[#111111]">
            Обо мне
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-gray-500">ФИО</dt>
            <dd className="text-[#111111]">{cabinet.name || '—'}</dd>
            <dt className="text-gray-500">Организация</dt>
            <dd className="text-[#111111]">
              {linked ? cabinet.organizations.join(', ') : 'пока не указана'}
            </dd>
          </dl>
          {!linked && (
            <p className="text-xs text-gray-500">
              Организация появится здесь сама, когда она добавит вас в заявку на обучение с тем же
              e-mail, с которым вы входите в кабинет. Если этого долго не происходит — напишите
              своему менеджеру.
            </p>
          )}
        </section>

        <section className={CARD} aria-labelledby="profile-trainings">
          <h2 id="profile-trainings" className="font-semibold text-[#111111]">
            Назначенные обучения
          </h2>
          {cabinet.trainings.length === 0 ? (
            <EmptyState
              icon="📚"
              title="Обучений пока нет"
              message="Обучение появится здесь после того, как заявку на него подтвердят."
              className="p-6"
              action={
                <Link href="/student" className="text-sm text-[#F97316] hover:underline">
                  На главную
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-gray-100" data-testid="profile-trainings">
              {cabinet.trainings.map((t) => (
                <li key={t.id} className="py-2.5 space-y-0.5">
                  <p className="text-sm font-medium text-[#111111]">{t.directionName}</p>
                  <p className="text-xs text-gray-600">
                    {t.statusLabel} · {trainingDates(t)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={CARD} aria-labelledby="profile-certificates">
          <h2 id="profile-certificates" className="font-semibold text-[#111111]">
            Удостоверения
          </h2>
          <StudentCertificatesList certificates={cabinet.certificates} />
        </section>
      </div>
    </AppShell>
  );
}
