import type { PrismaClient, Prisma } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';

export type AdminOrgErrorCode = 'forbidden' | 'not_found' | 'validation' | 'inn_exists';

export class AdminOrgError extends Error {
  readonly code: AdminOrgErrorCode;
  constructor(code: AdminOrgErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminOrgError';
  }
}

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type OrgFilters = {
  q?: string | undefined;
  partnerId?: string | undefined;
  withRateOverride?: boolean | undefined;
  /** `У-94`: только организации без ИНН — очередь работы после импорта выписки. */
  withoutInn?: boolean | undefined;
  take?: number | undefined;
  skip?: number | undefined;
};

export type OrgRow = {
  id: string;
  name: string;
  inn: string | null;
  externalId: string | null;
  partner: { id: string; name: string } | null;
  ordersCount: number;
  organizationUsersCount: number;
  partnerCommissionRate: number | null;
};

export async function listOrganizations(
  prisma: PrismaClient,
  filters: OrgFilters
): Promise<{ rows: OrgRow[]; total: number }> {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const skip = Math.max(filters.skip ?? 0, 0);

  const where: Prisma.OrganizationWhereInput = {};
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { inn: { contains: filters.q, mode: 'insensitive' } },
      { externalId: { contains: filters.q, mode: 'insensitive' } },
    ];
  }
  if (filters.partnerId) where.partnerId = filters.partnerId;
  if (filters.withRateOverride === true) where.partnerCommissionRate = { not: null };
  if (filters.withRateOverride === false) where.partnerCommissionRate = null;
  if (filters.withoutInn) where.inn = null;

  const [orgs, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true } },
        _count: { select: { orders: true, organizationUsers: true } },
      },
      orderBy: { name: 'asc' },
      take,
      skip,
    }),
    prisma.organization.count({ where }),
  ]);

  const rows: OrgRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    inn: o.inn,
    externalId: o.externalId,
    partner: o.partner ? { id: o.partner.id, name: o.partner.name } : null,
    ordersCount: o._count.orders,
    organizationUsersCount: o._count.organizationUsers,
    partnerCommissionRate:
      o.partnerCommissionRate !== null ? Number(o.partnerCommissionRate) : null,
  }));

  return { rows, total };
}

/**
 * Служебная «шапка» карточки организации: компания-владелец и счётчики
 * объёмов (заказы / сотрудники / пользователи кабинета).
 *
 * Дополняет `getOrganization` (реквизиты) — вместе они и есть карточка
 * /admin/organizations/[id]. `null` — организации нет.
 */
export async function getOrganizationMeta(prisma: PrismaClient, id: string) {
  return prisma.organization.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      _count: { select: { orders: true, students: true, organizationUsers: true } },
    },
  });
}

export type OrgDetail = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  externalId: string | null;
  partnerId: string | null;
  partner: { id: string; name: string } | null;
  partnerCommissionRate: number | null;
  partnerCommissionRateNote: string | null;
};

export async function getOrganization(prisma: PrismaClient, id: string): Promise<OrgDetail | null> {
  const o = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      inn: true,
      kpp: true,
      externalId: true,
      partnerId: true,
      partner: { select: { id: true, name: true } },
      partnerCommissionRate: true,
      partnerCommissionRateNote: true,
    },
  });
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    inn: o.inn,
    kpp: o.kpp,
    externalId: o.externalId,
    partnerId: o.partnerId,
    partner: o.partner ? { id: o.partner.id, name: o.partner.name } : null,
    partnerCommissionRate:
      o.partnerCommissionRate !== null ? Number(o.partnerCommissionRate) : null,
    partnerCommissionRateNote: o.partnerCommissionRateNote,
  };
}

export type CreateOrgArgs = {
  name: string;
  inn?: string | null;
  kpp?: string | null;
};

/**
 * Ручное создание организации админом (вне 1С). Организация заводится с
 * externalId=null — синхронизация матчит записи по externalId, поэтому ручную
 * организацию она не тронет и не задублирует. Как и синк новой организации
 * (writers.ts upsertOrgRecord), создаём для неё отдельную Company (C8: новая
 * организация = новая компания).
 *
 * Дубль ИНН невозможен: поле inn @unique в БД. Проверяем заранее ради
 * дружелюбного 'inn_exists', плюс ловим гонку через P2002.
 */
export async function createOrganization(
  prisma: PrismaClient,
  actorUserId: string,
  args: CreateOrgArgs
): Promise<{ ok: true; id: string } | { ok: false; error: AdminOrgErrorCode }> {
  const name = args.name?.trim() ?? '';
  const inn = args.inn?.trim() || null;
  const kpp = args.kpp?.trim() || null;
  if (!name) return { ok: false, error: 'validation' };

  if (inn) {
    const existing = await prisma.organization.findUnique({ where: { inn }, select: { id: true } });
    if (existing) return { ok: false, error: 'inn_exists' };
  }

  try {
    const id = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name } });
      const org = await tx.organization.create({
        // `У-84`: ключ названия — при каждом создании.
        data: {
          name,
          nameKey: organizationNameKey(name),
          inn,
          kpp,
          externalId: null,
          companyId: company.id,
        },
      });
      await recordAudit(tx, {
        userId: actorUserId,
        action: 'organization_created_manual',
        entity: 'organization',
        entityId: org.id,
        after: { name, inn, kpp, source: 'manual' },
      });
      return org.id;
    });
    return { ok: true, id };
  } catch (e) {
    // P2002 — гонка по уникальному inn: другая транзакция успела создать.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { ok: false, error: 'inn_exists' };
    }
    throw e;
  }
}

export type UpdateOrgArgs = {
  name?: string;
  inn?: string | null;
  kpp?: string | null;
};

export async function updateOrganization(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdateOrgArgs
): Promise<{ ok: true } | { ok: false; error: AdminOrgErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUnique({
        where: { id },
        select: { name: true, inn: true, kpp: true },
      });
      if (!before) throw new AdminOrgError('not_found');

      await tx.organization.update({
        where: { id },
        data: {
          // `У-84`: переименование пересчитывает ключ названия.
          ...(args.name !== undefined
            ? { name: args.name, nameKey: organizationNameKey(args.name) }
            : {}),
          ...(args.inn !== undefined ? { inn: args.inn } : {}),
          ...(args.kpp !== undefined ? { kpp: args.kpp } : {}),
        },
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'organization_updated',
        entity: 'organization',
        entityId: id,
        before,
        after: args,
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminOrgError) return { ok: false, error: e.code };
    throw e;
  }
}
