import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canTriageClientRequests } from '@/lib/services/clientRequests/policy';

export type InnDuplicates = {
  organizations: Array<{ id: string; name: string }>;
  leads: Array<{ id: string; subject: string; status: string }>;
};

export type FindByInnResult =
  | { ok: true; duplicates: InnDuplicates }
  | { ok: false; error: 'forbidden' | 'validation' };

/**
 * Антидубли по ИНН (этап 5 PR-2, ФТ-13.4) — ТОЛЬКО внутренняя сторона:
 * клиентским ролям факт существования ИНН в базе не раскрывается (защита
 * клиентской базы от перебора), поэтому гейт — canTriageClientRequests
 * (manager/admin), и роут живёт за тем же staff-гейтом.
 *
 * Выдача неблокирующая (плашка «Уже есть в базе»): организации по точному
 * ИНН + активные лиды (не rejected/promoted). ПДн физлиц в выдаче нет —
 * только названия организаций и темы лидов.
 */
export async function findByInn(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { inn: string }
): Promise<FindByInnResult> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };

  const inn = args.inn?.replace(/[\s-]/g, '') ?? '';
  if (!/^(\d{10}|\d{12})$/.test(inn)) return { ok: false, error: 'validation' };

  const [organizations, leads] = await Promise.all([
    prisma.organization.findMany({
      where: { inn },
      select: { id: true, name: true },
      take: 5
    }),
    prisma.lead.findMany({
      where: { clientInn: inn, status: { notIn: ['rejected', 'promoted_to_order'] } },
      select: { id: true, subject: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 5
    })
  ]);

  return { ok: true, duplicates: { organizations, leads } };
}
