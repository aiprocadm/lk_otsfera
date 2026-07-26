/**
 * Этап 8 (ФТ-9.1/9.2, PR-1) — чистая валидация реквизитов юрлица. Все поля
 * опциональны (реквизиты заполняются постепенно), но ЗАПОЛНЕННОЕ поле обязано
 * иметь корректный формат. Русские сообщения — сразу для UI. Общая для
 * организации/партнёра/компании (domain-agnostic набор ФТ-9.1).
 */

export type RequisitesInput = {
  legalName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  corrAccount?: string | null;
  bic?: string | null;
  signerName?: string | null;
  signerPosition?: string | null;
  signerBasis?: string | null;
};

export type RequisitesValues = Required<{ [K in keyof RequisitesInput]: string | null }>;

const MAX_TEXT = 300;

function digits(v: string): string {
  return v.replace(/[\s-]/g, '');
}

/** trim + пустая строка → null; отбраковка сверхдлинных значений. */
function norm(v: string | null | undefined): string | null {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
}

export function validateRequisites(
  input: RequisitesInput
): { ok: true; values: RequisitesValues } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const values = {
    legalName: norm(input.legalName),
    inn: norm(input.inn),
    kpp: norm(input.kpp),
    ogrn: norm(input.ogrn),
    legalAddress: norm(input.legalAddress),
    bankName: norm(input.bankName),
    bankAccount: norm(input.bankAccount),
    corrAccount: norm(input.corrAccount),
    bic: norm(input.bic),
    signerName: norm(input.signerName),
    signerPosition: norm(input.signerPosition),
    signerBasis: norm(input.signerBasis)
  };

  for (const [key, label] of Object.entries({
    legalName: 'Юридическое название',
    legalAddress: 'Юридический адрес',
    bankName: 'Название банка',
    signerName: 'ФИО подписанта',
    signerPosition: 'Должность подписанта',
    signerBasis: 'Основание полномочий'
  }) as Array<[keyof RequisitesValues, string]>) {
    const v = values[key];
    if (v && v.length > MAX_TEXT) errors.push(`${label}: не длиннее ${MAX_TEXT} символов`);
  }

  if (values.inn) {
    values.inn = digits(values.inn);
    if (!/^(\d{10}|\d{12})$/.test(values.inn)) errors.push('ИНН должен содержать 10 или 12 цифр');
  }
  if (values.kpp) {
    values.kpp = digits(values.kpp);
    if (!/^\d{9}$/.test(values.kpp)) errors.push('КПП должен содержать 9 цифр');
  }
  if (values.ogrn) {
    values.ogrn = digits(values.ogrn);
    if (!/^(\d{13}|\d{15})$/.test(values.ogrn)) errors.push('ОГРН должен содержать 13 цифр (или 15 для ИП)');
  }
  if (values.bic) {
    values.bic = digits(values.bic);
    if (!/^\d{9}$/.test(values.bic)) errors.push('БИК должен содержать 9 цифр');
  }
  if (values.bankAccount) {
    values.bankAccount = digits(values.bankAccount);
    if (!/^\d{20}$/.test(values.bankAccount)) errors.push('Расчётный счёт должен содержать 20 цифр');
  }
  if (values.corrAccount) {
    values.corrAccount = digits(values.corrAccount);
    if (!/^\d{20}$/.test(values.corrAccount)) errors.push('Корреспондентский счёт должен содержать 20 цифр');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values };
}
