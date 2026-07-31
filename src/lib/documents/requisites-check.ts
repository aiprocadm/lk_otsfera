/**
 * Этап 8 (ФТ-9.5, PR-2) — чистая проверка полноты реквизитов для генерации
 * документа (образец orders/completion.ts): русские названия недостающих
 * полей для «кнопка неактивна + список». Для счёта/акта обязательны:
 * исполнитель — юр. название, ИНН, адрес, банк полностью, подписант;
 * заказчик (организация) — юр. название|название, ИНН, адрес.
 */

export type PartyRequisites = {
  name?: string | null;
  legalName: string | null;
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
};

export type MissingRequisite = { side: 'company' | 'organization'; label: string };

const COMPANY_REQUIRED: Array<[keyof PartyRequisites, string]> = [
  ['legalName', 'юр. название исполнителя'],
  ['inn', 'ИНН исполнителя'],
  ['legalAddress', 'юр. адрес исполнителя'],
  ['bankName', 'банк исполнителя'],
  ['bankAccount', 'р/с исполнителя'],
  ['corrAccount', 'к/с исполнителя'],
  ['bic', 'БИК исполнителя'],
  ['signerName', 'подписант исполнителя (ФИО)'],
  ['signerPosition', 'должность подписанта исполнителя'],
];

const ORG_REQUIRED: Array<[keyof PartyRequisites, string]> = [
  ['inn', 'ИНН заказчика'],
  ['legalAddress', 'юр. адрес заказчика'],
];

export function listMissingRequisites(
  company: PartyRequisites,
  organization: PartyRequisites
): MissingRequisite[] {
  const missing: MissingRequisite[] = [];
  for (const [key, label] of COMPANY_REQUIRED) {
    if (!company[key]?.trim()) missing.push({ side: 'company', label });
  }
  // Название заказчика: юр. название ИЛИ рабочее название организации.
  if (!organization.legalName?.trim() && !organization.name?.trim()) {
    missing.push({ side: 'organization', label: 'юр. название заказчика' });
  }
  for (const [key, label] of ORG_REQUIRED) {
    if (!organization[key]?.trim()) missing.push({ side: 'organization', label });
  }
  return missing;
}
