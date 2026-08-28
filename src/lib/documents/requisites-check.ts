import { isValidInn } from '@/lib/services/oneCSync/inn';
import { isValidBankAccount, isValidOgrn } from '@/lib/requisites/checksum';

/**
 * Полнота реквизитов перед выпуском документа.
 *
 * Этап 8 (ФТ-9.5) проверял один и тот же набор для всех типов — из-за этого
 * договор без подписанта заказчика проходил (`Д-9`), а сам заказчик
 * проверялся только по ИНН и адресу (`Д-10`). `У-156` этапа 6: **набор
 * зависит от типа документа**.
 *
 * | Тип | Исполнитель | Заказчик |
 * |---|---|---|
 * | Счёт, акт | юр. название, ИНН, адрес, **банк целиком**, подписант | юр. название, ИНН, **КПП** (для юрлиц), адрес |
 * | Договор, ДС | то же **+ основание полномочий** | то же **+ подписант и основание** |
 *
 * Счёт платят по банковским реквизитам, поэтому у счёта они обязательны;
 * договор подписывают люди, поэтому у договора обязательны подписанты обеих
 * сторон и основание их полномочий («на основании чего действует»).
 *
 * Заполненные значения дополнительно проверяются контрольной суммой
 * (`Д-11`): реквизит с опечаткой хуже отсутствующего — он выглядит готовым.
 */

export type PartyRequisites = {
  name?: string | null;
  legalName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn?: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
  signerBasis?: string | null;
};

export type MissingRequisite = { side: 'company' | 'organization'; label: string };

export type RequisitesDocKind = 'invoice' | 'act' | 'contract' | 'extra_agreement';

type Field = [keyof PartyRequisites, string];

/** Нужно всегда: кем выставлен и кому. */
const COMPANY_BASE: Field[] = [
  ['legalName', 'юр. название исполнителя'],
  ['inn', 'ИНН исполнителя'],
  ['legalAddress', 'юр. адрес исполнителя'],
  ['signerName', 'подписант исполнителя (ФИО)'],
  ['signerPosition', 'должность подписанта исполнителя'],
];

/** Счёт платят по этим реквизитам — без них он бесполезен. */
const COMPANY_BANK: Field[] = [
  ['bankName', 'банк исполнителя'],
  ['bankAccount', 'р/с исполнителя'],
  ['corrAccount', 'к/с исполнителя'],
  ['bic', 'БИК исполнителя'],
];

const ORG_BASE: Field[] = [
  ['inn', 'ИНН заказчика'],
  ['legalAddress', 'юр. адрес заказчика'],
];

/** Договор подписывают люди: нужны обе подписи и основание полномочий. */
const ORG_CONTRACT: Field[] = [
  ['signerName', 'подписант заказчика (ФИО)'],
  ['signerPosition', 'должность подписанта заказчика'],
  ['signerBasis', 'основание полномочий заказчика'],
];

function isContractKind(docType: RequisitesDocKind): boolean {
  return docType === 'contract' || docType === 'extra_agreement';
}

function collect(
  party: PartyRequisites,
  side: 'company' | 'organization',
  fields: Field[],
  out: MissingRequisite[]
): void {
  for (const [key, label] of fields) {
    if (!party[key]?.trim()) out.push({ side, label });
  }
}

/**
 * Заполненное, но неверное значение — отдельная строка списка с объяснением.
 * ИНН и ОГРН проверяются всегда, расчётный счёт — только вместе с БИК
 * (без него контрольную сумму считать не из чего).
 */
function collectInvalid(
  party: PartyRequisites,
  side: 'company' | 'organization',
  who: string,
  out: MissingRequisite[]
): void {
  const inn = party.inn?.trim();
  if (inn && !isValidInn(inn)) {
    out.push({ side, label: `ИНН ${who} — неверная контрольная сумма` });
  }
  const ogrn = party.ogrn?.trim();
  if (ogrn && !isValidOgrn(ogrn)) {
    out.push({ side, label: `ОГРН ${who} — неверная контрольная сумма` });
  }
  const account = party.bankAccount?.trim();
  const bic = party.bic?.trim();
  if (account && bic && !isValidBankAccount(account, bic)) {
    out.push({ side, label: `р/с ${who} не сходится с БИК` });
  }
}

export function listMissingRequisites(
  company: PartyRequisites,
  organization: PartyRequisites,
  docType: RequisitesDocKind
): MissingRequisite[] {
  const missing: MissingRequisite[] = [];

  collect(company, 'company', COMPANY_BASE, missing);
  if (!isContractKind(docType)) {
    collect(company, 'company', COMPANY_BANK, missing);
  } else if (!company.signerBasis?.trim()) {
    missing.push({ side: 'company', label: 'основание полномочий исполнителя' });
  }

  // Название заказчика: юр. название ИЛИ рабочее название организации.
  if (!organization.legalName?.trim() && !organization.name?.trim()) {
    missing.push({ side: 'organization', label: 'юр. название заказчика' });
  }
  collect(organization, 'organization', ORG_BASE, missing);
  if (isContractKind(docType)) {
    collect(organization, 'organization', ORG_CONTRACT, missing);
  } else if (organization.inn?.trim().length === 10 && !organization.kpp?.trim()) {
    // КПП есть только у юрлиц: у ИП (12 цифр ИНН) его не существует, и
    // требовать его — значит не дать выставить счёт предпринимателю.
    missing.push({ side: 'organization', label: 'КПП заказчика' });
  }

  collectInvalid(company, 'company', 'исполнителя', missing);
  collectInvalid(organization, 'organization', 'заказчика', missing);
  return missing;
}
