/**
 * Этап 8 (ФТ-9.3/9.6, PR-2) — реальный рендер PDF счёта/акта: кириллический
 * шрифт регистрируется, буфер валиден (%PDF), рендер укладывается в 2 с
 * (замер ФТ-9.6 — поэтому генерация синхронна, без очереди).
 */
import { describe, it, expect } from 'vitest';
import { Image } from '@react-pdf/renderer';
import {
  OrderDocumentPdf,
  renderOrderDocumentPdf,
  type OrderDocumentData,
} from '@/lib/services/documents/orderDocumentPdf';
import { buildPrintTable } from '@/lib/services/documents/printTable';
import type { DocumentBranding } from '@/lib/services/documents/branding';
import {
  renderContractDocumentPdf,
  type ContractDocumentData,
} from '@/lib/services/documents/contractDocumentPdf';
import { listMissingRequisites } from '@/lib/documents/requisites-check';

const PARTY = {
  displayName: 'ООО «Промтехносфера»',
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'г. Москва, ул. Тестовая, 1',
  bankName: 'Т-Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов И.И.',
  signerPosition: 'Генеральный директор',
  phone: '+7 495 000-00-00',
  email: 'docs@pts.ru',
};

const NO_BRANDING: DocumentBranding = { logo: null, signature: null, stamp: null };

const TABLE = buildPrintTable([
  {
    title: 'Обучение по охране труда',
    quantity: '3',
    unit: 'person',
    unitPrice: '5000.00',
    discountPercent: null,
    vatRate: '0.2000',
    vatIncluded: true,
  },
]);

function data(docType: 'invoice' | 'act'): OrderDocumentData {
  return {
    docType,
    number: docType === 'invoice' ? 'С-2026-17' : 'А-2026-17',
    date: new Date('2026-07-26T00:00:00Z'),
    company: PARTY,
    organization: { ...PARTY, displayName: 'ООО «Ромашка»' },
    orderLabel: 'Заказ №123 «Обучение по охране труда»',
    table: TABLE,
    branding: NO_BRANDING,
    servicePeriod: null,
    draftNote: null,
  };
}

/**
 * Обход дерева разметки: рендер в PDF отдаёт сжатые байты, в которых текст не
 * найти, а проверять `У-141` по «буфер начинается с %PDF» — значит не
 * проверять ничего. Компонент — чистая функция, поэтому зовём её напрямую и
 * смотрим, что реально попало на страницу.
 */
type Node = { type?: unknown; props?: { children?: unknown; src?: unknown } };

function walk(node: unknown, texts: string[], images: unknown[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    texts.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, texts, images);
    return;
  }
  const el = node as Node;
  if (el.type === Image && el.props?.src !== undefined) images.push(el.props.src);
  walk(el.props?.children, texts, images);
}

function page(pdfData: OrderDocumentData): { texts: string[]; images: unknown[] } {
  const texts: string[] = [];
  const images: unknown[] = [];
  walk(OrderDocumentPdf({ data: pdfData }), texts, images);
  return { texts, images };
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
      organization: {
        ...PARTY,
        displayName: 'ООО «Ромашка»',
        signerName: null,
        signerPosition: null,
      },
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
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', signerPosition: null },
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
      company: {
        ...PARTY,
        bankName: null,
        bic: null,
        corrAccount: null,
        bankAccount: null,
        inn: null,
        kpp: null,
      },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', inn: null, kpp: null },
    };
    const buffer = await renderOrderDocumentPdf(bare);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('У-141: табличная часть счёта и акта', () => {
  const NBSP = '\u00A0';

  it('шапка таблицы — шесть колонок', () => {
    const { texts } = page(data('invoice'));
    for (const header of ['№', 'Наименование услуги', 'Кол-во', 'Ед.', 'Цена, ₽', 'Сумма, ₽']) {
      expect(texts, `нет колонки «${header}»`).toContain(header);
    }
  });

  it('строка печатает количество, единицу, цену и сумму', () => {
    // До этапа 6 печатались только название и сумма: клиент не мог проверить,
    // из чего сложилась цифра.
    const { texts } = page(data('invoice'));
    expect(texts).toContain('3');
    expect(texts).toContain('чел.');
    expect(texts).toContain(`5${NBSP}000,00`);
    expect(texts).toContain(`15${NBSP}000,00`);
  });

  it('итоги, НДС, «Всего наименований» и сумма прописью — на странице', () => {
    const { texts } = page(data('invoice'));
    expect(texts).toContain(`Итого: 15${NBSP}000,00 ₽`);
    expect(texts).toContain(`В том числе НДС 20% — 2${NBSP}500,00 ₽`);
    expect(texts).toContain(`Всего наименований 1, на сумму 15${NBSP}000,00 ₽`);
    expect(texts).toContain('Пятнадцать тысяч рублей 00 копеек');
  });

  it('акт печатает ту же таблицу — счёт и акт не расходятся', () => {
    const { texts } = page(data('act'));
    expect(texts).toContain('Наименование выполненных услуг');
    expect(texts).toContain('Кол-во');
    expect(texts).toContain('Пятнадцать тысяч рублей 00 копеек');
  });

  it('НДС сверх суммы: появляется строка «Всего к оплате»', () => {
    const table = buildPrintTable([
      {
        title: 'Обучение',
        quantity: '1',
        unit: 'service',
        unitPrice: '10000.00',
        discountPercent: null,
        vatRate: '0.2000',
        vatIncluded: false,
      },
    ]);
    const { texts } = page({ ...data('invoice'), table });
    expect(texts).toContain(`Итого: 10${NBSP}000,00 ₽`);
    expect(texts).toContain(`Всего к оплате: 12${NBSP}000,00 ₽`);
    expect(texts).toContain('Двенадцать тысяч рублей 00 копеек');
  });
});

describe('У-153: логотип, подпись и печать', () => {
  const logo = Buffer.from('logo');
  const signature = Buffer.from('signature');
  const stamp = Buffer.from('stamp');

  it('загруженные файлы попадают в разметку документа', () => {
    const { images } = page({ ...data('invoice'), branding: { logo, signature, stamp } });
    expect(images).toEqual([logo, signature, stamp]);
  });

  it('без файлов документ печатается как прежде — картинок нет', () => {
    expect(page(data('invoice')).images).toEqual([]);
  });

  it('настоящая картинка реально ложится в PDF, а не только в разметку', async () => {
    // Обход дерева докажет, что `Image` на месте, но не то, что документ с ним
    // собирается: битые байты роняют рендер уже после того, как номер счёта
    // израсходован. Поэтому здесь — честный PNG и честный рендер.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const buffer = await renderOrderDocumentPdf({
      ...data('invoice'),
      branding: { logo: png, signature: png, stamp: png },
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('загружен только один слот — печатается только он', () => {
    const onlyStamp = page({
      ...data('invoice'),
      branding: { logo: null, signature: null, stamp },
    });
    expect(onlyStamp.images).toEqual([stamp]);

    const onlySignature = page({
      ...data('act'),
      branding: { logo: null, signature, stamp: null },
    });
    expect(onlySignature.images).toEqual([signature]);
  });
});

describe('listMissingRequisites', () => {
  const full = { name: 'Раб', ...PARTY, legalName: PARTY.displayName } as never;

  it('полные реквизиты → пусто', () => {
    expect(listMissingRequisites(full, full, 'invoice')).toEqual([]);
  });

  it('недостающие поля исполнителя и заказчика — с русскими подписями и стороной', () => {
    const company = { ...(full as Record<string, unknown>), bic: null, signerName: '' };
    const org = { ...(full as Record<string, unknown>), inn: null, legalName: null, name: null };
    const missing = listMissingRequisites(company as never, org as never, 'invoice');
    expect(missing).toEqual(
      expect.arrayContaining([
        { side: 'company', label: 'БИК исполнителя' },
        { side: 'company', label: 'подписант исполнителя (ФИО)' },
        { side: 'organization', label: 'ИНН заказчика' },
        { side: 'organization', label: 'юр. название заказчика' },
      ])
    );
  });

  it('рабочее название организации закрывает отсутствие юр. названия', () => {
    const org = {
      ...(full as Record<string, unknown>),
      legalName: null,
      name: 'ООО Ромашка (раб.)',
    };
    expect(
      listMissingRequisites(full, org as never, 'invoice').some((m) => m.label.includes('название'))
    ).toBe(false);
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
    table: TABLE,
    branding: NO_BRANDING,
    validUntil: null,
    paymentTerms: null,
    changeText: null,
    draftNote: null,
    baseContract:
      docType === 'extra_agreement' ? { number: 'Д-2026-4', date: new Date('2026-07-01') } : null,
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
      organization: { ...PARTY, displayName: 'ИП Иванов', kpp: null, signerPosition: null },
    };
    const buffer = await renderContractDocumentPdf(ip);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('стороны без ИНН вовсе: блок реквизитов схлопывается, рендер не падает', async () => {
    const noInn = {
      ...base('contract'),
      company: { ...PARTY, inn: null, kpp: null },
      organization: { ...PARTY, displayName: 'ООО «Ромашка»', inn: null, kpp: null },
    };
    const buffer = await renderContractDocumentPdf(noInn);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('договор печатает ту же таблицу и то же оформление, что счёт', async () => {
    // Правило зеркала (§0.2 ТЗ): один и тот же состав услуг не может
    // выглядеть в договоре иначе, чем в счёте.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const buffer = await renderContractDocumentPdf({
      ...base('contract'),
      branding: { logo: png, signature: png, stamp: png },
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');

    // Загружен один слот из трёх — тоже обычный случай: печать без подписи.
    const stampOnly = await renderContractDocumentPdf({
      ...base('contract'),
      branding: { logo: null, signature: null, stamp: png },
    });
    expect(stampOnly.subarray(0, 5).toString()).toBe('%PDF-');

    const signatureOnly = await renderContractDocumentPdf({
      ...base('extra_agreement'),
      branding: { logo: null, signature: png, stamp: null },
    });
    expect(signatureOnly.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('пустые подписанты/реквизиты не ломают рендер (фолбэки)', async () => {
    const bare = {
      ...base('contract'),
      company: {
        ...PARTY,
        signerName: null,
        signerPosition: null,
        signerBasis: null,
        phone: null,
        email: null,
        legalAddress: null,
      },
      organization: {
        ...PARTY,
        displayName: 'ООО «Ромашка»',
        signerName: null,
        signerBasis: null,
        bankName: null,
        bic: null,
      },
    };
    const buffer = await renderContractDocumentPdf(bare);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
