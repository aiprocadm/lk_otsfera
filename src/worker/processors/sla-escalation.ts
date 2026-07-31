import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { INTAKE_BREACH_HOURS } from '@/lib/services/intake/list';
import { log } from '@/lib/logging';

/**
 * Этап 7 (§4.4, ФТ-8.5, PR-3) — SLA-эскалация Intake: единицы БЕЗ
 * ответственного, ждущие дольше `Company.slaResponseHours` (единицы общей
 * очереди без компании — дефолт-порог), эскалируются руководителям компании
 * (общая очередь — руководителям всех компаний: она видна в каждом Intake).
 * Решение §10-2 спеки: ОДНО уведомление на единицу, без повторов — дедуп
 * через журнал `SlaEscalation` (@@unique[sourceType,sourceId] + P2002-skip,
 * образец CertificateReminder). Идемпотентно; ошибка доставки конкретному
 * получателю логируется и не валит джоб.
 */

const BATCH_LIMIT = 200;
const ESCALATION_URL = '/leader/intake';

type Unit = {
  sourceType: 'client_request' | 'enrollment' | 'inbound' | 'call';
  sourceId: string;
  companyId: string | null;
  createdAt: Date;
  label: string;
};

type CompanyInfo = { id: string; slaResponseHours: number; leaders: string[] };

async function loadCompanies(prisma: PrismaClient): Promise<CompanyInfo[]> {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      slaResponseHours: true,
      users: {
        where: { role: 'manager', managerRole: 'leader', isActive: true },
        select: { id: true },
      },
    },
  });
  return companies.map((c) => ({
    id: c.id,
    slaResponseHours: c.slaResponseHours,
    leaders: c.users.map((u) => u.id),
  }));
}

/** Неразобранные единицы без ответственного (адм-широкий срез — джоб платформенный). */
async function loadUnassignedUnits(prisma: PrismaClient): Promise<Unit[]> {
  const [requests, enrollments, inbound, calls] = await Promise.all([
    prisma.clientRequest.findMany({
      where: { status: 'submitted' },
      select: {
        id: true,
        createdAt: true,
        companyName: true,
        subject: true,
        organization: { select: { companyId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.enrollmentRequest.findMany({
      where: { status: 'pending', claimedByUserId: null },
      select: {
        id: true,
        createdAt: true,
        organization: { select: { name: true, companyId: true } },
        direction: { select: { name: true } },
        legacyCourseTitle: true,
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.inboundMessage.findMany({
      where: { status: 'unresolved', claimedByUserId: null },
      select: {
        id: true,
        createdAt: true,
        companyId: true,
        senderDisplay: true,
        senderRef: true,
        subject: true,
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.call.findMany({
      where: {
        direction: 'inbound',
        resolvedOrgId: null,
        contactId: null,
        intakeClosedAt: null,
        lead: null,
        claimedByUserId: null,
      },
      select: { id: true, createdAt: true, companyId: true, callerNumber: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
  ]);

  const units: Unit[] = [];
  for (const r of requests) {
    units.push({
      sourceType: 'client_request',
      sourceId: r.id,
      companyId: r.organization?.companyId ?? null,
      createdAt: r.createdAt,
      label: `заявка клиента «${r.subject}» (${r.companyName})`,
    });
  }
  for (const e of enrollments) {
    const direction = e.direction?.name ?? e.legacyCourseTitle ?? 'обучение';
    units.push({
      sourceType: 'enrollment',
      sourceId: e.id,
      companyId: e.organization?.companyId ?? null,
      createdAt: e.createdAt,
      label: `заявка на обучение «${direction}»${e.organization ? ` (${e.organization.name})` : ''}`,
    });
  }
  for (const m of inbound) {
    units.push({
      sourceType: 'inbound',
      sourceId: m.id,
      companyId: m.companyId,
      createdAt: m.createdAt,
      label: `обращение от ${m.senderDisplay?.trim() || m.senderRef}${m.subject ? `: «${m.subject}»` : ''}`,
    });
  }
  for (const c of calls) {
    units.push({
      sourceType: 'call',
      sourceId: c.id,
      companyId: c.companyId,
      createdAt: c.createdAt,
      label: `входящий звонок с ${c.callerNumber}`,
    });
  }
  return units;
}

export async function runSlaEscalation(
  prisma: PrismaClient,
  now: Date
): Promise<{ escalated: number }> {
  const companies = await loadCompanies(prisma);
  const byCompanyId = new Map(companies.map((c) => [c.id, c]));
  const allLeaders = [...new Set(companies.flatMap((c) => c.leaders))];

  const units = await loadUnassignedUnits(prisma);

  let escalated = 0;
  for (const unit of units) {
    const company = unit.companyId ? byCompanyId.get(unit.companyId) : undefined;
    const thresholdHours = company?.slaResponseHours ?? INTAKE_BREACH_HOURS;
    const ageHours = (now.getTime() - unit.createdAt.getTime()) / 3_600_000;
    if (ageHours <= thresholdHours) continue;

    const recipients = company ? company.leaders : allLeaders;
    if (recipients.length === 0) continue;

    // Дедуп: одна эскалация на единицу за всю её жизнь (решение §10-2).
    try {
      await prisma.slaEscalation.create({
        data: { sourceType: unit.sourceType, sourceId: unit.sourceId, companyId: unit.companyId },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue;
      throw e;
    }

    const waitedHours = Math.floor(ageHours);
    const title = 'SLA: входящее без реакции';
    const body = `Без ответственного ${waitedHours} ч (порог ${thresholdHours} ч): ${unit.label}.`;

    for (const userId of recipients) {
      try {
        const row = await createNotification({
          userId,
          type: 'sla_escalation',
          title,
          body,
          meta: { sourceType: unit.sourceType, sourceId: unit.sourceId, url: ESCALATION_URL },
        });
        await deliverNotificationToUser({
          userId,
          title,
          body,
          type: 'sla_escalation',
          url: ESCALATION_URL,
          dedupKey: row.id,
        });
      } catch (err) {
        log.error('[sla-escalation] notify failed', {
          userId,
          sourceType: unit.sourceType,
          sourceId: unit.sourceId,
          error: (err as Error).message,
        });
      }
    }

    escalated += 1;
  }

  return { escalated };
}

/** BullMQ wrapper, вызывается воркером по расписанию. */
export async function slaEscalationProcessor(): Promise<{ escalated: number }> {
  const { prisma } = await import('@/lib/db/prisma');
  return runSlaEscalation(prisma, new Date());
}
