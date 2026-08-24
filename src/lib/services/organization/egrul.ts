import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Заполнение карточки организации данными из ЕГРЮЛ (`У-94`).
 *
 * Организации, заведённые импортом выписки по названию (`У-86`), приходят без
 * ИНН: в выписке его просто нет. Дальше без ИНН не собрать ни счёт, ни акт, и
 * следующий импорт не свяжет её по ИНН. Раньше реквизиты приходилось вбивать
 * руками, сверяясь со сторонним сайтом.
 *
 * **Заполняются только выбранные поля.** Человек мог уже внести часть данных
 * руками — затирать их подсказкой нельзя, поэтому сервис принимает ровно те
 * поля, которые отмечены галочками на экране, и молча игнорирует остальные.
 */
export type EgrulField = 'inn' | 'kpp' | 'legalName' | 'ogrn' | 'legalAddress';

export const EGRUL_FIELDS: readonly EgrulField[] = [
  'inn',
  'kpp',
  'legalName',
  'ogrn',
  'legalAddress',
];

/** Подписи полей для экрана и для журнала — один источник (`У-76`). */
export const EGRUL_FIELD_LABELS: Record<EgrulField, string> = {
  inn: 'ИНН',
  kpp: 'КПП',
  legalName: 'Юр. название',
  ogrn: 'ОГРН',
  legalAddress: 'Юр. адрес',
};

export type FillFromEgrulError = 'forbidden' | 'not_found' | 'nothing_selected' | 'inn_taken';

export type FillFromEgrulResult =
  | { ok: true; filled: EgrulField[] }
  | { ok: false; error: FillFromEgrulError };

async function canEdit(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<boolean> {
  // Model A: администратор ведёт всё через своё зеркало.
  if (session.role === 'admin') return true;
  // Руководитель и менеджер — по своему скоупу (C8 внутри предиката).
  if (session.role === 'leader' || session.role === 'manager') {
    return canManagerAccessOrg(prisma, session, orgId);
  }
  // Заказчик и партнёр реквизиты ведут сами, но ЕГРЮЛ-подстановка — это
  // инструмент учебного центра: `У-94` называет три роли и только их.
  return false;
}

export async function fillFromEgrul(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orgId: string; values: Partial<Record<EgrulField, string>> }
): Promise<FillFromEgrulResult> {
  if (!(await canEdit(prisma, session, args.orgId))) return { ok: false, error: 'forbidden' };

  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: {
      id: true,
      companyId: true,
      inn: true,
      kpp: true,
      legalName: true,
      ogrn: true,
      legalAddress: true,
    },
  });
  if (!org) return { ok: false, error: 'not_found' };

  // Пустые строки — это «поле не отмечено», а не «стереть значение»: стирать
  // реквизиты подсказкой из ЕГРЮЛ нельзя.
  const data: Prisma.OrganizationUpdateInput = {};
  const filled: EgrulField[] = [];
  for (const field of EGRUL_FIELDS) {
    const value = args.values[field]?.trim();
    if (!value) continue;
    data[field] = value;
    filled.push(field);
  }
  if (filled.length === 0) return { ok: false, error: 'nothing_selected' };

  if (data.inn) {
    // ИНН — ключ связи с 1С и матчером импорта. Два клиента одной компании с
    // одним ИНН сделали бы привязку платежей неоднозначной.
    const clash = await prisma.organization.findFirst({
      where: { inn: data.inn as string, companyId: org.companyId, id: { not: org.id } },
      select: { id: true },
    });
    if (clash) return { ok: false, error: 'inn_taken' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: org.id }, data });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'organization_egrul_filled',
      entity: 'organization',
      entityId: org.id,
      before: Object.fromEntries(filled.map((f) => [f, org[f] ?? null])),
      after: Object.fromEntries(filled.map((f) => [f, args.values[f]?.trim() ?? null])),
    });
  });

  return { ok: true, filled };
}
