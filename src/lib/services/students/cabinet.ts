import type { EnrollmentStatus, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { moscowDaysUntil } from '@/lib/tasks/due';
import { linkStudentCardsToAccount } from './account';

/**
 * Кабинет слушателя (`У-284`, `У-285`, этап 2 ТЗ 13.10.2026): что видит человек
 * после входа — свои обучения со сроками и удостоверения.
 *
 * Скоуп — карточки справочника, привязанные к учётке (`Student.userId =
 * session.sub`). Перед чтением свободные карточки с тем же e-mail
 * привязываются (`Р-2-2`): слушатель, которого завели в заявку до появления
 * учётки, видит своё обучение при первом же входе.
 */

/** Подписи статуса — о самом человеке, а не о заявке целиком. */
const TRAINING_STATUS_LABEL: Record<Exclude<EnrollmentStatus, 'rejected'>, string> = {
  pending: 'Заявка на рассмотрении',
  approved: 'Обучение назначено',
  provisioned: 'Доступ к учебной площадке открыт',
  in_training: 'Идёт обучение',
  certificates_ready: 'Удостоверение готово',
};

export type StudentTraining = {
  id: string;
  directionName: string;
  organizationName: string;
  status: Exclude<EnrollmentStatus, 'rejected'>;
  statusLabel: string;
  /** Дата без времени (`YYYY-MM-DD`) или null — сроки ещё не назначены. */
  startsOn: string | null;
  endsOn: string | null;
};

export type StudentCertificateView = {
  id: string;
  directionName: string;
  number: string;
  issuedAt: string;
  /** `YYYY-MM-DD` или null — бессрочное. */
  validUntil: string | null;
  /**
   * Сколько московских дней до конца срока (`У-284` «когда он истекает»):
   * `0` — сегодня последний день, отрицательное — истекло; null — бессрочное.
   */
  daysLeft: number | null;
};

export type StudentCabinet = {
  name: string;
  /** Организации, к которым прикреплён слушатель (по одной на карточку). */
  organizations: string[];
  trainings: StudentTraining[];
  certificates: StudentCertificateView[];
};

/** Дата `@db.Date` приходит полуночью UTC — день берём по UTC, без сдвига пояса. */
function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function getStudentCabinet(
  prisma: PrismaClient,
  session: SessionPayload,
  now: Date = new Date()
): Promise<{ ok: true; cabinet: StudentCabinet } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'student') return { ok: false, error: 'forbidden' };
  await linkStudentCardsToAccount(prisma, session.sub);
  const cards = await prisma.student.findMany({
    where: { userId: session.sub },
    select: {
      id: true,
      name: true,
      organization: { select: { name: true } },
      enrollmentItems: {
        where: { status: { not: 'rejected' } },
        select: {
          id: true,
          status: true,
          startsOn: true,
          endsOn: true,
          direction: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      certificates: {
        select: {
          id: true,
          number: true,
          issuedAt: true,
          validUntil: true,
          direction: { select: { name: true } },
        },
        orderBy: { issuedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const trainings: StudentTraining[] = cards.flatMap((card) =>
    card.enrollmentItems.map((item) => {
      // Отклонённые отсечены выборкой — тип сужаем для словаря подписей.
      const status = item.status as Exclude<EnrollmentStatus, 'rejected'>;
      return {
        id: item.id,
        directionName: item.direction.name,
        organizationName: card.organization.name,
        status,
        statusLabel: TRAINING_STATUS_LABEL[status],
        startsOn: day(item.startsOn),
        endsOn: day(item.endsOn),
      };
    })
  );
  const certificates: StudentCertificateView[] = cards.flatMap((card) =>
    card.certificates.map((c) => ({
      id: c.id,
      directionName: c.direction.name,
      number: c.number,
      issuedAt: c.issuedAt.toISOString(),
      validUntil: day(c.validUntil),
      daysLeft: c.validUntil ? moscowDaysUntil(c.validUntil, now) : null,
    }))
  );
  return {
    ok: true,
    cabinet: {
      name: cards[0]?.name ?? session.name ?? '',
      organizations: [...new Set(cards.map((c) => c.organization.name))],
      trainings,
      certificates,
    },
  };
}
