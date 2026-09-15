import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Этап 7 (§4.4, PR-3) — пороги SLA входящих компании: `slaResponseHours`
 * (эскалация руководителю; дефолт 24) и `slaWarningHours` (жёлтая подсветка в
 * Intake; дефолт 4). Образец teamVisibility: идемпотентно, авторизация — на
 * вызывающем (leader/admin server-action), аудит без ПДн.
 */

const SLA_MIN_HOURS = 1;
const SLA_MAX_HOURS = 168; // неделя — верхняя граница разумного порога

export type SlaSettings = {
  slaResponseHours: number;
  slaWarningHours: number;
  /**
   * `У-225` (этап 4): на какой день просрочки задачи сообщать руководителю.
   * `0` — не сообщать вовсе. Здесь ДНИ, а не часы: задача живёт неделями, и
   * порог в часах пришлось бы каждый раз переводить в уме.
   */
  taskOverdueEscalationDays: number;
};

/** Предел порога просрочки задач: больше месяца — это уже не напоминание. */
const TASK_OVERDUE_MAX_DAYS = 30;

/** Строка экрана «SLA входящих в работу» (`У-130`): компания и её пороги. */
export type CompanySla = SlaSettings & { id: string; name: string };

const SLA_LIST_SELECT = {
  id: true,
  name: true,
  slaResponseHours: true,
  slaWarningHours: true,
  taskOverdueEscalationDays: true,
} as const;

/**
 * Список компаний с порогами SLA для экрана `У-130`. Выборка живёт здесь, а не
 * в компоненте (`components-no-db`): админ видит **все** компании (пороги
 * задаёт каждая сама, ему нужна картина целиком), руководитель — только свою.
 * Ошибка базы проглатывается в пустой список — экран покажет пустое состояние,
 * а не 500 (то же поведение, что было до выноса из компонента).
 */
export async function listCompaniesSla(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; companies: CompanySla[] } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  if (session.role === 'admin') {
    const companies = await prisma.company
      .findMany({ select: SLA_LIST_SELECT, orderBy: { name: 'asc' } })
      .catch(() => []);
    return { ok: true, companies };
  }
  // Руководитель без компании: в базу не ходим — экран объяснит, что
  // настраивать нечего (`role="alert"` вместо пустоты).
  if (!session.companyId) return { ok: true, companies: [] };
  const companies = await prisma.company
    .findMany({ where: { id: session.companyId }, select: SLA_LIST_SELECT })
    .catch(() => []);
  return { ok: true, companies };
}

export async function getSlaSettings(
  prisma: PrismaClient,
  companyId: string
): Promise<SlaSettings | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      slaResponseHours: true,
      slaWarningHours: true,
      taskOverdueEscalationDays: true,
    },
  });
  return company ?? null;
}

export type SetSlaSettingsResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'company_not_found' | 'validation'; messages?: string[] };

export async function setSlaSettings(
  prisma: PrismaClient,
  actorUserId: string,
  companyId: string,
  input: SlaSettings
): Promise<SetSlaSettingsResult> {
  const messages: string[] = [];
  const { slaResponseHours, slaWarningHours, taskOverdueEscalationDays } = input;
  if (
    !Number.isInteger(slaResponseHours) ||
    slaResponseHours < SLA_MIN_HOURS ||
    slaResponseHours > SLA_MAX_HOURS
  ) {
    messages.push(`Порог эскалации — целое число от ${SLA_MIN_HOURS} до ${SLA_MAX_HOURS} часов`);
  }
  if (
    !Number.isInteger(slaWarningHours) ||
    slaWarningHours < SLA_MIN_HOURS ||
    slaWarningHours > SLA_MAX_HOURS
  ) {
    messages.push(`Порог подсветки — целое число от ${SLA_MIN_HOURS} до ${SLA_MAX_HOURS} часов`);
  }
  if (
    !Number.isInteger(taskOverdueEscalationDays) ||
    taskOverdueEscalationDays < 0 ||
    taskOverdueEscalationDays > TASK_OVERDUE_MAX_DAYS
  ) {
    messages.push(
      `Просрочка задач — целое число от 0 до ${TASK_OVERDUE_MAX_DAYS} дней (0 — не сообщать)`
    );
  }
  if (messages.length === 0 && slaWarningHours >= slaResponseHours) {
    messages.push('Порог подсветки должен быть меньше порога эскалации');
  }
  if (messages.length > 0) return { ok: false, error: 'validation', messages };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      slaResponseHours: true,
      slaWarningHours: true,
      taskOverdueEscalationDays: true,
    },
  });
  if (!company) return { ok: false, error: 'company_not_found' };
  if (
    company.slaResponseHours === slaResponseHours &&
    company.slaWarningHours === slaWarningHours &&
    company.taskOverdueEscalationDays === taskOverdueEscalationDays
  ) {
    return { ok: true, changed: false };
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { slaResponseHours, slaWarningHours, taskOverdueEscalationDays },
  });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'sla_settings_changed',
    entity: 'company',
    entityId: companyId,
    before: company,
    after: { slaResponseHours, slaWarningHours, taskOverdueEscalationDays },
  });
  return { ok: true, changed: true };
}
