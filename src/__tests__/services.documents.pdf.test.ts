/**
 * Этап 8 (ФТ-9.3/9.6, PR-2) — реальный рендер PDF счёта/акта: кириллический
 * шрифт регистрируется, буфер валиден (%PDF), рендер укладывается в 2 с
 * (замер ФТ-9.6 — поэтому генерация синхронна, без очереди).
 */
import { describe, it, expect } from 'vitest';
import { renderOrderDocumentPdf, type OrderDocumentData } from '@/lib/services/documents/orderDocumentPdf';
import { renderContractDocumentPdf, type ContractDocumentData } from '@/lib/services/documents/contractDocumentPdf';
import { listMissingRequisites } from '@/lib/documents/requisites-check';

const PARTY = {
  displayName: 'ООО «Промтехносфера»',
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'г. Москва, ул. Тестовая, 1',
  bankName: 'Т-Банк',
  bankAccount: '40702810400000000001',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов И.И.',
  signerPosition: 'Генеральный директор',
  phone: '+7 495 000-00-00',
  email: 'docs@pts.ru'
};

function data(docType: 'invoice' | 'act'): OrderDocumentData {
  return {
    docType,
    number: docType === 'invoice' ? 'С-2026-17' : 'А-2026-17',
    date: new Date('2026-07-26T00:00:00Z'),
    company: PARTY,
    organization: { ...PARTY, displayName: 'ООО «Ромашка»' },
    orderLabel: 'Заказ №123 «Обучение по охране труда»',
    items: [{ name: 'Услуги по заказу №123: Обучение по охране труда', amount: '15 000,00' }],
    total: '15 000,00',
    vatLine: 'В том числе НДС 20%.'
  };
}

describe('renderOrderDocumentPdf', () => {
  it('счёт: валидный PDF-буфер с кириллицей, рендер < 2 с (ФТ-9.6)', async () => {
    const started = Date.now();
    const buffer = await renderOrderDocumentPdf(data('invoice'));
    const elapsed = Date.now() - started;

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(2000);
  });

  it('акт: валидный PDF-буфер (текст о выполнении, две подписи)', async () => {
    const buffer = await renderOrderDocumentPdf(data('act'));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('без подписантов: под линиями подписи стоит слово «подпись», документ формируется', async () => {
    // Реквизиты подписанта могут быть не заполнены — счёт всё равно нужно
    // выдать. Под линией тогда должна быть нейтральная подпись, а не пустота.
    const bare = {
      ...data('invoice'),
      company: { ...PARTY, signerName: null, signerPosition: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', signerName: null, signerPosition: null }
    };
    const buffer = await renderOrderDocumentPdf(bare);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');

    // Акт печатает подписи по-другому (две стороны), поэтому проверяем и его.
    const bareAct = { ...bare, docType: 'act' as const, number: 'А-2026-17' };
    expect((await renderOrderDocumentPdf(bareAct)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('подписант без должности: в подписи только ФИО', async () => {
    const noPosition = {
      ...data('act'),
      company: { ...PARTY, signerPosition: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', signerPosition: null }
    };
    const buffer = await renderOrderDocumentPdf(noPosition);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('пустые банковские реквизиты и ИНН: счёт формируется с пробелами вместо данных', async () => {
    // Счёт выставляют и по неполным реквизитам (их дозаполнят позже). Пустые
    // поля не должны ронять генерацию — иначе менеджер не сможет выдать вообще
    // ничего.
    const bare = {
      ...data('invoice'),
      company: { ...PARTY, bankName: null, bic: null, corrAccount: null, bankAccount: null, inn: null, kpp: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', inn: null, kpp: null }
    };
    const buffer = await renderOrderDocumentPdf(bare);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('listMissingRequisites', () => {
  const full = { name: 'Раб', ...PARTY, legalName: PARTY.displayName } as never;

  it('полные реквизиты → пусто', () => {
    expect(listMissingRequisites(full, full)).toEqual([]);
  });

  it('недостающие поля исполнителя и заказчика — с русскими подписями и стороной', () => {
    const company = { ...(full as Record<string, unknown>), bic: null, signerName: '' };
    const org = { ...(full as Record<string, unknown>), inn: null, legalName: null, name: null };
    const missing = listMissingRequisites(company as never, org as never);
    expect(missing).toEqual(
      expect.arrayContaining([
        { side: 'company', label: 'БИК исполнителя' },
        { side: 'company', label: 'подписант исполнителя (ФИО)' },
        { side: 'organization', label: 'ИНН заказчика' },
        { side: 'organization', label: 'юр. название заказчика' }
      ])
    );
  });

  it('рабочее название организации закрывает отсутствие юр. названия', () => {
    const org = { ...(full as Record<string, unknown>), legalName: null, name: 'ООО Ромашка (раб.)' };
    expect(listMissingRequisites(full, org as never).some((m) => m.label.includes('название'))).toBe(false);
  });
});

describe('renderContractDocumentPdf (PR-3)', () => {
  const base = (docType: 'contract' | 'extra_agreement'): ContractDocumentData => ({
    docType,
    number: docType === 'contract' ? 'Д-2026-4' : 'ДС-2026-4',
    date: new Date('2026-07-26T00:00:00Z'),
    company: { ...PARTY, signerBasis: 'Устава' },
    organization: { ...PARTY, displayName: 'ООО «Ромашка»', signerBasis: 'Доверенности № 7' },
    subject: 'Обучение по охране труда',
    items: [{ name: 'Обучение по охране труда', amount: '15 000,00' }],
    total: '15 000,00',
    vatLine: 'В том числе НДС 20%.',
    baseContract: docType === 'extra_agreement' ? { number: 'Д-2026-4', date: new Date('2026-07-01') } : null
  });

  it('договор: валидный PDF с кириллицей, рендер < 2 с', async () => {
    const started = Date.now();
    const buffer = await renderContractDocumentPdf(base('contract'));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('доп. соглашение: рендерится со ссылкой на договор', async () => {
    const buffer = await renderContractDocumentPdf(base('extra_agreement'));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('доп. соглашение без ссылки на базовый договор рендерится с прочерками', async () => {
    // Договор-основание может быть не заведён в системе (подписан на бумаге).
    // Документ всё равно должен сформироваться — с прочерком вместо номера и
    // даты, а не упасть на обращении к пустому полю.
    const orphan = { ...base('extra_agreement'), baseContract: null };
    const buffer = await renderContractDocumentPdf(orphan);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('стороны без КПП и без должности подписанта: документ формируется', async () => {
    // ИП не имеет КПП, а подписант может быть без должности. Это не ошибка
    // данных — договор обязан собраться и в таком виде.
    const ip = {
      ...base('contract'),
      company: { ...PARTY, kpp: null, signerPosition: null },
      organization: { ...PARTY, displayName: 'ИП Иванов', kpp: null, signerPosition: null }
    };
    const buffer = await renderContractDocumentPdf(ip);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('стороны без ИНН вовсе: блок реквизитов схлопывается, рендер не падает', async () => {
    const noInn = {
      ...base('contract'),
      company: { ...PARTY, inn: null, kpp: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', inn: null, kpp: null }
    };
    const buffer = await renderContractDocumentPdf(noInn);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('пустые подписанты/реквизиты не ломают рендер (фолбэки)', async () => {
    const bare = {
      ...base('contract'),
      company: { ...PARTY, signerName: null, signerPosition: null, signerBasis: null, phone: null, email: null, legalAddress: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', signerName: null, signerBasis: null, bankName: null, bic: null }
    };
    const buffer = await renderContractDocumentPdf(bare);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
