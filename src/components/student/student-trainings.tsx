import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { fmtDate, pluralizeRu } from '@/lib/format';
import { REMINDER_THRESHOLDS } from '@/lib/services/training/expiry';
import type { StudentCertificateView, StudentTraining } from '@/lib/services/students/cabinet';

/**
 * Кабинет слушателя (`У-284`, `У-285`, этап 2 ТЗ 13.10.2026) — презентационные
 * блоки. Данные даёт сервис `getStudentCabinet`, в базу компоненты не ходят.
 */

/** `YYYY-MM-DD` → «01.11.2026». */
const dayRu = (ymd: string) => fmtDate(new Date(`${ymd}T00:00:00Z`));

/** Сроки обучения словами; null — сроки ещё не назначены. */
export function trainingDates(t: Pick<StudentTraining, 'startsOn' | 'endsOn'>): string {
  if (t.startsOn && t.endsOn) return `с ${dayRu(t.startsOn)} по ${dayRu(t.endsOn)}`;
  if (t.startsOn) return `с ${dayRu(t.startsOn)}`;
  if (t.endsOn) return `до ${dayRu(t.endsOn)}`;
  return 'сроки ещё не назначены';
}

const PORTAL_LINK =
  'inline-block rounded-lg bg-[#F97316] hover:bg-[#EA580C] text-white px-3 py-1.5 text-sm font-semibold transition-colors';

/** «Мои обучения» — главная слушателя (`У-285`). */
export function StudentTrainingsList({ trainings }: { trainings: StudentTraining[] }) {
  if (trainings.length === 0) {
    return (
      <EmptyState
        icon="📚"
        title="Обучений пока нет"
        message="Обучение появится здесь, когда организация подаст заявку и её подтвердят. Если вы ждёте курс — спросите своего руководителя или менеджера."
        action={
          <Link href="/help" className="text-sm text-[#F97316] hover:underline">
            Как это работает — в справке
          </Link>
        }
      />
    );
  }
  return (
    <ul className="space-y-3" data-testid="student-trainings">
      {trainings.map((t) => (
        <li
          key={t.id}
          className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-semibold text-[#111111]">{t.directionName}</p>
            <p className="text-sm text-gray-600">
              {t.statusLabel} · {trainingDates(t)}
            </p>
            <p className="text-xs text-gray-500">Организация: {t.organizationName}</p>
          </div>
          {/* `Р-2-5`: учебная площадка у компании одна — кнопка ведёт туда же,
              что и «Перейти к обучению»; вход выполняется автоматически. */}
          <Link href="/student/redirect" className={PORTAL_LINK}>
            Перейти на учебную площадку
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Когда истекает удостоверение — словами (`У-284`). */
export function certificateExpiry(c: Pick<StudentCertificateView, 'validUntil' | 'daysLeft'>): {
  text: string;
  tone: 'ok' | 'soon' | 'expired';
} {
  if (!c.validUntil || c.daysLeft === null) return { text: 'Бессрочное', tone: 'ok' };
  const until = dayRu(c.validUntil);
  if (c.daysLeft < 0) return { text: `Срок действия истёк ${until}`, tone: 'expired' };
  if (c.daysLeft === 0) return { text: `Действует последний день — ${until}`, tone: 'soon' };
  const left = `${c.daysLeft} ${pluralizeRu(c.daysLeft, 'день', 'дня', 'дней')}`;
  // «Скоро» — с первого напоминания об удостоверении: тот же порог, что у писем.
  return {
    text: `Действует до ${until} — осталось ${left}`,
    tone: c.daysLeft <= Math.max(...REMINDER_THRESHOLDS) ? 'soon' : 'ok',
  };
}

const TONE: Record<'ok' | 'soon' | 'expired', string> = {
  ok: 'text-gray-600',
  soon: 'text-amber-700',
  expired: 'text-red-600',
};

/** Удостоверения слушателя (`У-284`): номер, направление, когда истекает. */
export function StudentCertificatesList({
  certificates,
}: {
  certificates: StudentCertificateView[];
}) {
  if (certificates.length === 0) {
    return (
      <EmptyState
        icon="📜"
        title="Удостоверений пока нет"
        message="Удостоверение появится здесь после окончания обучения."
        className="p-6"
        action={
          <Link href="/student" className="text-sm text-[#F97316] hover:underline">
            Мои обучения
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-gray-100" data-testid="student-certificates">
      {certificates.map((c) => {
        const exp = certificateExpiry(c);
        return (
          <li key={c.id} className="py-2.5 space-y-0.5">
            <p className="text-sm font-medium text-[#111111]">
              {c.directionName} · № {c.number}
            </p>
            <p className="text-xs text-gray-500">Выдано {fmtDate(c.issuedAt)}</p>
            <p className={`text-xs ${TONE[exp.tone]}`}>{exp.text}</p>
          </li>
        );
      })}
    </ul>
  );
}
