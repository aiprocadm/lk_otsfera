/**
 * Этап 8 (ФТ-9.3/9.6, PR-2) — реальный рендер PDF счёта/акта: кириллический
 * шрифт регистрируется, буфер валиден (%PDF), рендер укладывается в 2 с
 * (замер ФТ-9.6 — поэтому генерация синхронна, без очереди).
 */
import { describe, it, expect } from 'vitest';
import { renderOrderDocumentPdf, type OrderDocumentData } from '@/lib/services/documents/orderDocumentPdf';
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
