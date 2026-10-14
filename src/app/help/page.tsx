import type { Metadata } from 'next';
import React from 'react';
import { requireSession } from '@/lib/auth/requireRole';
import { BackLink } from '@/components/ui';
import { GLOSSARY } from '@/lib/help/glossary';
import { STUDENT_HELP_INTRO, STUDENT_HELP_TOPICS } from '@/lib/help/studentHelp';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Справка · Словарь терминов' };

/**
 * Словарь терминов (`У-76`, этап 9).
 *
 * Один экран на все шесть кабинетов: слова в системе одинаковые для всех, и
 * держать шесть копий словаря — верный способ получить шесть разных смыслов.
 * Доступ — любой вошедший пользователь: `/help` не входит ни в один защищённый
 * префикс, поэтому middleware пускает сюда все роли (но не анонимов).
 */
/**
 * Справка слушателя (`У-287`): вместо словаря CRM — три мини-инструкции об
 * обучении. Словарь для остальных ролей не меняется.
 */
function StudentHelp() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <BackLink href="/dashboard" label="Вернуться в кабинет" />
        <PageHeader title="Справка" subtitle={STUDENT_HELP_INTRO} />
        {STUDENT_HELP_TOPICS.map((topic) => (
          <section
            key={topic.id}
            className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
            data-testid={`student-help-${topic.id}`}
          >
            <h2 className="font-semibold text-[#111111]">{topic.title}</h2>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700">
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {topic.note && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                {topic.note}
              </p>
            )}
          </section>
        ))}
        <p className="text-xs text-gray-500">
          Не нашли ответ — напишите своему менеджеру или ответственному за обучение в вашей
          организации.
        </p>
      </div>
    </main>
  );
}

export default async function HelpPage() {
  const session = await requireSession();
  if (session.role === 'student') return <StudentHelp />;
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Страница живёт вне кабинетов, поэтому меню тут нет — но человек не
            должен оказаться в тупике (§15). `/dashboard` — виртуальный алиас,
            middleware уводит его в кабинет по роли. */}
        <BackLink href="/dashboard" label="Вернуться в кабинет" />
        <div>
          <PageHeader
            title="Справка"
            subtitle="Что означают слова, которыми говорит кабинет, — простыми словами и без сокращений."
          />
        </div>

        {GLOSSARY.map((section) => (
          <section
            key={section.id}
            className="bg-white border border-gray-200 rounded-xl p-5 space-y-4"
            data-testid={`glossary-section-${section.id}`}
          >
            <div>
              <h2 className="font-semibold text-[#111111]">{section.title}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{section.intro}</p>
            </div>
            <dl className="space-y-4">
              {section.terms.map((t) => (
                <div key={`${section.id}-${t.term}`}>
                  <dt className="text-sm font-medium text-[#111111]">{t.term}</dt>
                  <dd className="text-sm text-gray-600 mt-0.5">{t.meaning}</dd>
                  {t.notThis && (
                    <dd className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-1">
                      {t.notThis}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        ))}

        <p className="text-xs text-gray-500">
          Не нашли слово или объяснение не помогло — напишите нам через «Задать вопрос» в своём
          кабинете: добавим в словарь.
        </p>
      </div>
    </main>
  );
}
