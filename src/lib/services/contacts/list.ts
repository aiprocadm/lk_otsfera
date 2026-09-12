import type { ContactChannelType, Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { canUseContacts, contactScopeWhere } from './scope';

/** Постраничность списка контактов (`У-178`): 50 строк и честный `total`. */
export const CONTACT_LIST_PAGE = 50;

type ContactListScope = 'all' | 'with_org' | 'without_org' | 'archived';
type ContactListSort = 'name' | 'updated';

export type ContactListFilters = {
  q?: string | undefined;
  scope?: ContactListScope | undefined;
  sort?: ContactListSort | undefined;
  page?: number | undefined;
  /** Контакты одной организации — вкладка «Контакты» карточки (`У-182`). */
  organizationId?: string | undefined;
};

export type ContactChannelView = {
  id: string;
  type: ContactChannelType;
  value: string;
  isPrimary: boolean;
};

type ContactListItem = {
  id: string;
  name: string;
  position: string | null;
  organization: { id: string; name: string } | null;
  channels: ContactChannelView[];
  isArchived: boolean;
  updatedAt: Date;
};

export type ContactListResult =
  | { ok: true; items: ContactListItem[]; total: number; page: number; pageSize: number }
  | { ok: false; error: 'forbidden' };

const LIST_SELECT = {
  id: true,
  name: true,
  position: true,
  isArchived: true,
  updatedAt: true,
  organization: { select: { id: true, name: true } },
  channels: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, type: true, value: true, isPrimary: true },
  },
} satisfies Prisma.ContactSelect;

/**
 * Цифры телефона из строки поиска: «+7 (921) 123-45-67», «8921…» и «921 123»
 * должны находить один контакт (`У-185`). Хранится канон `+7…`, поэтому у
 * написания через «8» отбрасываем первую цифру. Короче пяти цифр — не телефон.
 */
export function phoneDigitsCandidates(q: string): string[] {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 5) return [];
  return digits.startsWith('8') ? [digits, digits.slice(1)] : [digits];
}

/**
 * Условие поиска по имени, организации, e-mail и телефону в любом написании.
 * Общее для списка и глобального поиска; `null` — строка слишком короткая.
 */
export function contactSearchWhere(q: string): Prisma.ContactWhereInput | null {
  const text = q.trim().slice(0, 100);
  if (text.length < 2) return null;
  const insensitive = 'insensitive' as const;
  const or: Prisma.ContactWhereInput[] = [
    { name: { contains: text, mode: insensitive } },
    { organization: { is: { name: { contains: text, mode: insensitive } } } },
    { channels: { some: { type: 'email', normalizedValue: { contains: text.toLowerCase() } } } },
  ];
  for (const digits of phoneDigitsCandidates(text)) {
    or.push({
      channels: {
        some: { type: { in: ['phone', 'whatsapp'] }, normalizedValue: { contains: digits } },
      },
    });
  }
  return { OR: or };
}

function scopeFilter(scope: ContactListScope): Prisma.ContactWhereInput {
  switch (scope) {
    case 'archived':
      return { isArchived: true };
    case 'with_org':
      return { isArchived: false, organizationId: { not: null } };
    case 'without_org':
      return { isArchived: false, organizationId: null };
    case 'all':
      return { isArchived: false };
  }
}

/**
 * Список контактов (`У-178`): скоуп — `contactScopeWhere`, фильтры, сортировка,
 * постраничность с `total`. Просмотр списка — чтение ПДн (`У-186`).
 */
export async function listContacts(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  filters: ContactListFilters = {}
): Promise<ContactListResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const search = filters.q ? contactSearchWhere(filters.q) : null;
  const where: Prisma.ContactWhereInput = {
    AND: [
      contactScopeWhere(session, teamMode),
      scopeFilter(filters.scope ?? 'all'),
      ...(filters.organizationId ? [{ organizationId: filters.organizationId }] : []),
      ...(search ? [search] : []),
    ],
  };
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    filters.sort === 'updated'
      ? [{ updatedAt: 'desc' }, { id: 'asc' }]
      : [{ name: 'asc' }, { id: 'asc' }];
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: LIST_SELECT,
      orderBy,
      skip: (page - 1) * CONTACT_LIST_PAGE,
      take: CONTACT_LIST_PAGE,
    }),
    prisma.contact.count({ where }),
  ]);
  await recordPiiAccess(prisma, {
    session,
    context: 'contacts_list',
    subjectIds: rows.map((r) => r.id),
    meta: { take: CONTACT_LIST_PAGE, hasQuery: !!search },
  });
  return { ok: true, items: rows, total, page, pageSize: CONTACT_LIST_PAGE };
}
