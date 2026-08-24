'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  fillFromEgrul,
  EGRUL_FIELDS,
  type EgrulField,
  type FillFromEgrulError,
} from '@/lib/services/organization/egrul';

/**
 * Заполнение реквизитов организации из ЕГРЮЛ (`У-94`).
 *
 * Действие только принимает форму: право, границу компании, проверку на
 * дубль ИНН и запись в журнал держит сервис (§3, §4). Роль здесь не
 * проверяется списком — иначе правило разъехалось бы с сервисом.
 */
const schema = z.object({
  organizationId: z.string().min(1),
  values: z.record(z.string(), z.string()),
});

export type FillFromEgrulActionResult =
  | { ok: true; filled: EgrulField[] }
  | { ok: false; error: FillFromEgrulError | 'validation' };

export async function fillOrgFromEgrulAction(input: {
  organizationId: string;
  values: Record<string, string>;
}): Promise<FillFromEgrulActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireSession();

  // Лишние ключи из формы до сервиса не доходят: подставить в организацию
  // произвольное поле через это действие нельзя.
  const values: Partial<Record<EgrulField, string>> = {};
  for (const field of EGRUL_FIELDS) {
    const value = parsed.data.values[field];
    if (typeof value === 'string' && value.trim()) values[field] = value;
  }

  const res = await fillFromEgrul(prisma, session, {
    orgId: parsed.data.organizationId,
    values,
  });
  if (!res.ok) return res;

  // Карточка организации есть у трёх кабинетов сотрудников — обновляем все.
  for (const base of ['/admin/organizations', '/leader/organizations', '/manager/organizations']) {
    revalidatePath(`${base}/${parsed.data.organizationId}`);
    revalidatePath(base);
  }
  return { ok: true, filled: res.filled };
}
