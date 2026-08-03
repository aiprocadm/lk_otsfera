import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Этап 7 (§4.4, PR-3) — пороги SLA входящих компании: `slaResponseHours`
 * (эскалация руководителю; дефолт 24) и `slaWarningHours` (жёлтая подсветка в
 * Intake; дефолт 4). Образец teamVisibility: идемпотентно, авторизация — на
 * вызывающем (leader/admin server-action), аудит без ПДн.
 */

const SLA_MIN_HOURS = 1;
const SLA_MAX_HOURS = 168; // неделя — верхняя граница разумного порога

export type SlaSettings = { slaResponseHours: number; slaWarningHours: number };

export async function getSlaSettings(
  prisma: PrismaClient,
  companyId: string
): Promise<SlaSettings | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { slaResponseHours: true, slaWarningHours: true },
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
  const { slaResponseHours, slaWarningHours } = input;
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
  if (messages.length === 0 && slaWarningHours >= slaResponseHours) {
    messages.push('Порог подсветки должен быть меньше порога эскалации');
  }
  if (messages.length > 0) return { ok: false, error: 'validation', messages };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { slaResponseHours: true, slaWarningHours: true },
  });
  if (!company) return { ok: false, error: 'company_not_found' };
  if (
    company.slaResponseHours === slaResponseHours &&
    company.slaWarningHours === slaWarningHours
  ) {
    return { ok: true, changed: false };
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { slaResponseHours, slaWarningHours },
  });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'sla_settings_changed',
    entity: 'company',
    entityId: companyId,
    before: company,
    after: { slaResponseHours, slaWarningHours },
  });
  return { ok: true, changed: true };
}
