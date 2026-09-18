'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  copyTargetsFromPreviousMonth,
  setActiveMetrics,
  upsertKpiTarget,
  type KpiSettingsError,
} from '@/lib/services/kpi/settings';

/**
 * Действия хаба «Показатели и планы» (`У-242`, этап 7).
 *
 * Тонкий адаптер над сервисом (§3): разбираем форму, зовём сервис, обновляем
 * страницу. Права проверяет сервис — здесь только форма и флаг.
 */
export type KpiActionResult = { ok: true } | { ok: false; error: KpiSettingsError };

function revalidate(): void {
  revalidatePath('/admin/settings/processes/kpi');
  revalidatePath('/leader/settings/processes/kpi');
}

function readInt(fd: FormData, key: string): number {
  return Number(fd.get(key));
}

export async function setActiveMetricsAction(fd: FormData): Promise<KpiActionResult> {
  notFoundIfDisabled('leader_analytics');
  const session = await requireSession();
  // Чекбоксы приходят списком значений одного имени; пустой список — «ничего
  // не выбрано», и это законно: тогда показывается умолчание реестра.
  const keys = fd.getAll('metric').map(String);
  const res = await setActiveMetrics(prisma, session, keys);
  if (res.ok) revalidate();
  return res;
}

export async function upsertKpiTargetAction(fd: FormData): Promise<KpiActionResult> {
  notFoundIfDisabled('leader_analytics');
  const session = await requireSession();
  const managerId = String(fd.get('managerId') ?? '');
  const raw = String(fd.get('amount') ?? '').trim();
  const res = await upsertKpiTarget(prisma, session, {
    metric: String(fd.get('metric') ?? ''),
    // Пустая строка — план компании: у показателя без ответственного менеджера
    // нет вовсе (`Р-Э7-3`).
    managerId: managerId === '' ? null : managerId,
    year: readInt(fd, 'year'),
    month: readInt(fd, 'month'),
    // Пустое поле — «убрать план», а не «ноль»: ноль означал бы «ничего не
    // ждём», а это другое утверждение.
    amount: raw === '' ? null : raw.replace(',', '.'),
  });
  if (res.ok) revalidate();
  return res;
}

export async function copyKpiTargetsAction(
  fd: FormData
): Promise<{ ok: true; copied: number } | { ok: false; error: KpiSettingsError }> {
  notFoundIfDisabled('leader_analytics');
  const session = await requireSession();
  const res = await copyTargetsFromPreviousMonth(prisma, session, {
    year: readInt(fd, 'year'),
    month: readInt(fd, 'month'),
  });
  if (res.ok) revalidate();
  return res;
}
