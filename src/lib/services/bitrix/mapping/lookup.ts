import type { ContactChannelType, PrismaClient } from '@prisma/client';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';
import type { ExistingContact, ChannelOwnerRef } from './contacts';
import type { ExistingOrganization } from './organizations';
import type { ExistingLead } from './leads';
import type { ExistingDeal } from './deals';
import type { ExistingTask } from './tasks';
import type { CandidateOrder } from './orders';

/**
 * Чтение состояния ЛК ПАЧКОЙ на страницу источника (`У-200`).
 *
 * Правило простое: сколько бы записей ни пришло со страницы, база спрашивается
 * фиксированное число раз — по одному запросу на способ поиска. Поиск по
 * строке был бы тем самым «спросить базу на каждой строке», от которого
 * страдали фоновые задачи до сопровождения.
 */
export type OrganizationBatch = {
  byBitrixId: Map<string, ExistingOrganization>;
  byInn: Map<string, ExistingOrganization>;
  byNameKey: Map<string, ExistingOrganization>;
};

const ORG_SELECT = {
  id: true,
  companyId: true,
  name: true,
  inn: true,
  kpp: true,
  bitrixId: true,
  nameKey: true,
} as const;

export async function loadOrganizations(
  prisma: PrismaClient,
  companyId: string,
  keys: { bitrixIds: string[]; inns: string[]; nameKeys: string[] }
): Promise<OrganizationBatch> {
  const rows = await prisma.organization.findMany({
    where: {
      OR: [
        keys.bitrixIds.length > 0 ? { bitrixId: { in: keys.bitrixIds } } : null,
        // ИНН уникален глобально: ищем без фильтра по компании, иначе тёзку из
        // чужой компании мы не увидим и упрёмся в уникальный индекс при записи.
        keys.inns.length > 0 ? { inn: { in: keys.inns } } : null,
        keys.nameKeys.length > 0 ? { companyId, nameKey: { in: keys.nameKeys } } : null,
      ].filter((w): w is NonNullable<typeof w> => w !== null),
    },
    select: ORG_SELECT,
  });

  const batch: OrganizationBatch = {
    byBitrixId: new Map(),
    byInn: new Map(),
    byNameKey: new Map(),
  };
  for (const row of rows) {
    const entry: ExistingOrganization = {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      inn: row.inn,
      kpp: row.kpp,
      bitrixId: row.bitrixId,
    };
    if (row.bitrixId) batch.byBitrixId.set(row.bitrixId, entry);
    if (row.inn) batch.byInn.set(row.inn, entry);
    // По названию узнаём только свои: чужая компания — не наша организация.
    if (row.nameKey && row.companyId === companyId) batch.byNameKey.set(row.nameKey, entry);
  }
  return batch;
}

export function organizationKeysOf(
  companies: readonly { id: string; inn: string | null; title: string }[]
): { bitrixIds: string[]; inns: string[]; nameKeys: string[] } {
  const nameKeys = companies
    .map((c) => organizationNameKey(c.title))
    .filter((k): k is string => Boolean(k));
  return {
    bitrixIds: companies.map((c) => c.id),
    inns: companies.map((c) => c.inn).filter((i): i is string => Boolean(i)),
    nameKeys,
  };
}

export type ContactBatch = {
  byBitrixId: Map<string, ExistingContact>;
  byId: Map<string, ExistingContact>;
  channelOwners: Map<string, ChannelOwnerRef>;
  userChannels: Set<string>;
};

export const channelKey = (type: ContactChannelType, normalizedValue: string): string =>
  `${type}:${normalizedValue}`;

export async function loadContacts(
  prisma: PrismaClient,
  companyId: string,
  keys: { bitrixIds: string[]; channels: { type: ContactChannelType; normalizedValue: string }[] }
): Promise<ContactBatch> {
  const normalized = keys.channels.map((c) => c.normalizedValue);
  const [contacts, channels, users] = await Promise.all([
    keys.bitrixIds.length > 0
      ? prisma.contact.findMany({
          where: { companyId, bitrixId: { in: keys.bitrixIds } },
          select: { id: true, name: true, position: true, organizationId: true, bitrixId: true },
        })
      : Promise.resolve([]),
    normalized.length > 0
      ? prisma.contactChannel.findMany({
          where: { companyId, normalizedValue: { in: normalized } },
          select: {
            type: true,
            normalizedValue: true,
            contact: {
              select: {
                id: true,
                name: true,
                position: true,
                organizationId: true,
                bitrixId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    normalized.length > 0
      ? prisma.user.findMany({
          where: {
            companyId,
            OR: [{ email: { in: normalized } }, { whatsappPhone: { in: normalized } }],
          },
          select: { email: true, whatsappPhone: true },
        })
      : Promise.resolve([]),
  ]);

  const batch: ContactBatch = {
    byBitrixId: new Map(),
    byId: new Map(),
    channelOwners: new Map(),
    userChannels: new Set(),
  };
  const remember = (c: ExistingContact) => {
    batch.byId.set(c.id, c);
    if (c.bitrixId) batch.byBitrixId.set(c.bitrixId, c);
  };
  for (const c of contacts) remember(c);
  for (const ch of channels) {
    remember(ch.contact);
    batch.channelOwners.set(channelKey(ch.type, ch.normalizedValue), {
      contactId: ch.contact.id,
      contactName: ch.contact.name,
      bitrixId: ch.contact.bitrixId,
    });
  }
  for (const u of users) {
    if (u.email) batch.userChannels.add(channelKey('email', u.email.toLowerCase()));
    if (u.whatsappPhone) batch.userChannels.add(channelKey('phone', u.whatsappPhone));
  }
  return batch;
}

export async function loadLeads(
  prisma: PrismaClient,
  bitrixIds: string[]
): Promise<Map<string, ExistingLead>> {
  if (bitrixIds.length === 0) return new Map();
  const rows = await prisma.lead.findMany({
    where: { bitrixId: { in: bitrixIds } },
    select: { id: true, subject: true, status: true, funnelStageId: true, bitrixId: true },
  });
  return new Map(rows.map((r) => [r.bitrixId as string, r]));
}

export async function loadDeals(
  prisma: PrismaClient,
  companyId: string,
  bitrixIds: string[]
): Promise<Map<string, ExistingDeal>> {
  if (bitrixIds.length === 0) return new Map();
  const rows = await prisma.deal.findMany({
    where: { companyId, bitrixId: { in: bitrixIds } },
    select: {
      id: true,
      title: true,
      status: true,
      stageId: true,
      orderId: true,
      organizationId: true,
      wonAt: true,
      lostAt: true,
      bitrixId: true,
    },
  });
  return new Map(rows.map((r) => [r.bitrixId as string, r]));
}

export async function loadTasks(
  prisma: PrismaClient,
  companyId: string,
  bitrixIds: string[]
): Promise<Map<string, ExistingTask>> {
  if (bitrixIds.length === 0) return new Map();
  const rows = await prisma.task.findMany({
    where: { companyId, bitrixId: { in: bitrixIds } },
    select: {
      id: true,
      title: true,
      status: true,
      columnId: true,
      completedAt: true,
      bitrixId: true,
    },
  });
  return new Map(rows.map((r) => [r.bitrixId as string, r]));
}

export async function loadDocuments(
  prisma: PrismaClient,
  companyId: string,
  bitrixIds: string[]
): Promise<Set<string>> {
  if (bitrixIds.length === 0) return new Set();
  const rows = await prisma.document.findMany({
    where: { companyId, bitrixId: { in: bitrixIds } },
    select: { bitrixId: true },
  });
  return new Set(rows.map((r) => r.bitrixId as string));
}

/** Заказы организаций, к которым примеряются выигранные сделки (`У-197`). */
export async function loadOrders(
  prisma: PrismaClient,
  companyId: string,
  organizationIds: string[]
): Promise<Map<string, CandidateOrder[]>> {
  if (organizationIds.length === 0) return new Map();
  const rows = await prisma.order.findMany({
    where: { companyId, organizationId: { in: organizationIds } },
    select: {
      id: true,
      organizationId: true,
      externalId: true,
      orderNumber: true,
      totalAmount: true,
      closedAt: true,
      completedAt: true,
    },
  });
  const out = new Map<string, CandidateOrder[]>();
  for (const row of rows) {
    const list = out.get(row.organizationId) ?? [];
    list.push({
      id: row.id,
      externalId: row.externalId,
      orderNumber: row.orderNumber,
      totalAmount: String(row.totalAmount),
      closedAt: row.closedAt,
      completedAt: row.completedAt,
    });
    out.set(row.organizationId, list);
  }
  return out;
}

/** Сотрудники компании — кандидаты в ответственные (`У-192`). */
export async function loadCompanyUsers(
  prisma: PrismaClient,
  companyId: string
): Promise<{ id: string; email: string; name: string }[]> {
  return prisma.user.findMany({
    where: { companyId, isActive: true, role: { in: ['manager', 'leader', 'admin'] } },
    select: { id: true, email: true, name: true },
    orderBy: { name: 'asc' },
  });
}
