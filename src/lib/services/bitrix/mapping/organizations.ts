import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';
import { isValidInn, normalizeInn } from '@/lib/services/oneCSync/inn';
import type { BitrixCompany } from '../source';
import type { MappingContext, Plan, PlanBefore } from './types';

/**
 * Компания Битрикса → `Organization` (`У-191`, спека §3.3).
 *
 * Порядок поиска жёсткий: `bitrixId` (уже переносили) → ИНН → нормализованное
 * название в своей компании → создать. ИНН уникален ГЛОБАЛЬНО, поэтому тёзка
 * в чужой компании — конфликт, а не «обновим»: запись в чужой контур ЛК
 * запрещена, и молча создать дубль тоже нельзя (упрёмся в уникальный индекс).
 *
 * `externalId` не трогаем никогда — он принадлежит 1С; связь с Битриксом живёт
 * в отдельной колонке `bitrixId`.
 */
export type OrganizationData = {
  name: string;
  nameKey: string | null;
  inn: string | null;
  kpp: string | null;
  companyId: string;
  bitrixId: string;
  /** Ответственный из Битрикса — заводится как менеджер организации. */
  managerUserId: string | null;
  /** Пометка для карточки, когда портал не дал ИНН. */
  note: string | null;
};

/** Что уже есть в ЛК по этой компании — читается пачкой на страницу. */
export type OrganizationLookup = {
  byBitrixId: (bitrixId: string) => ExistingOrganization | undefined;
  byInn: (inn: string) => ExistingOrganization | undefined;
  byNameKey: (nameKey: string) => ExistingOrganization | undefined;
};

export type ExistingOrganization = {
  id: string;
  companyId: string | null;
  name: string;
  inn: string | null;
  kpp: string | null;
  bitrixId: string | null;
};

export const NO_INN_NOTE = 'ИНН не указан в Битрикс24';

export function planOrganization(
  company: BitrixCompany,
  ctx: MappingContext,
  lookup: OrganizationLookup
): Plan<OrganizationData> {
  const name = company.title.trim() || `Компания Битрикс24 #${company.id}`;
  const nameKey = organizationNameKey(name);
  const inn =
    company.inn && isValidInn(normalizeInn(company.inn)) ? normalizeInn(company.inn) : null;
  const managerUserId = ctx.resolveUser(company.assignedById) ?? ctx.defaultManagerId;

  const data: OrganizationData = {
    name,
    nameKey,
    inn,
    kpp: company.kpp?.trim() || null,
    companyId: ctx.companyId,
    bitrixId: company.id,
    managerUserId,
    note: inn ? null : NO_INN_NOTE,
  };

  const existing =
    lookup.byBitrixId(company.id) ??
    (inn ? lookup.byInn(inn) : undefined) ??
    (nameKey ? lookup.byNameKey(nameKey) : undefined);

  if (!existing) return { action: 'create', data };

  if (existing.companyId && existing.companyId !== ctx.companyId) {
    return {
      action: 'conflict',
      reason: 'inn_other_company',
      hint: `«${existing.name}» уже заведена в другой компании`,
    };
  }

  // Пустое из Битрикса не затирает заполненное в ЛК (`У-171`, спека §3.4).
  const patch: Partial<OrganizationData> = {};
  const before: PlanBefore<OrganizationData> = {};
  if (name && name !== existing.name) {
    patch.name = name;
    patch.nameKey = nameKey;
    before.name = existing.name;
  }
  if (inn && inn !== existing.inn) {
    patch.inn = inn;
    before.inn = existing.inn;
  }
  if (data.kpp && data.kpp !== existing.kpp) {
    patch.kpp = data.kpp;
    before.kpp = existing.kpp;
  }
  if (!existing.bitrixId) {
    patch.bitrixId = company.id;
    before.bitrixId = null;
  }
  if (Object.keys(patch).length === 0) return { action: 'skip', reason: 'no_changes' };
  return { action: 'update', id: existing.id, data: patch, before };
}
