import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  OrgDocumentSentTemplate,
  orgDocumentSentSubject,
  orgDocumentSentText,
  type OrgDocumentSentProps,
} from '@/lib/email/templates';

/**
 * `У-149` — письмо «направляем вам документ».
 *
 * Проверяем не вёрстку, а то, что человек поймёт письмо без нашей системы:
 * что именно прислали, по какому заказу и куда идти за оригиналом.
 */
const base: OrgDocumentSentProps = {
  organizationName: 'ООО «Ромашка»',
  documentType: 'invoice',
  documentNumber: 'С-2026-17',
  documentName: 'invoice-v1-abc.pdf',
  documentUrl: 'https://lk.test/organization/documents/doc-1',
  orderNumber: 'ON-1',
  orderTitle: 'Обучение',
};

describe('письмо «документ отправлен заказчику»', () => {
  it('в теме — что за документ и по какому заказу', () => {
    expect(orgDocumentSentSubject(base)).toBe('Счёт № С-2026-17 по заказу № ON-1');
  });

  it('без номера заказа берётся его название', () => {
    expect(orgDocumentSentSubject({ ...base, orderNumber: null })).toBe(
      'Счёт № С-2026-17 по заказу «Обучение»'
    );
  });

  it('документ вне заказа — тема только про сам документ', () => {
    expect(
      orgDocumentSentSubject({ ...base, orderNumber: null, orderTitle: null })
    ).toBe('Счёт № С-2026-17');
  });

  it('без номера документа — хотя бы тип, а не пустота', () => {
    expect(
      orgDocumentSentSubject({
        ...base,
        documentNumber: null,
        orderNumber: null,
        orderTitle: null,
      })
    ).toBe('Счёт');
  });

  it('незнакомый тип не ломает письмо', () => {
    expect(
      orgDocumentSentSubject({
        ...base,
        documentType: 'weird',
        documentNumber: null,
        orderNumber: null,
        orderTitle: null,
      })
    ).toBe('Документ');
  });

  it('в письме есть организация, ссылка и упоминание вложения', () => {
    const html = renderToStaticMarkup(React.createElement(OrgDocumentSentTemplate, base));
    expect(html).toContain('ООО «Ромашка»');
    expect(html).toContain('https://lk.test/organization/documents/doc-1');
    expect(html).toContain('Открыть в личном кабинете');
    expect(html).toContain('приложен к письму');
    expect(html).toContain('ON-1');
  });

  it('письмо про документ вне заказа не упоминает заказ', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgDocumentSentTemplate, {
        ...base,
        orderNumber: null,
        orderTitle: null,
      })
    );
    expect(html).toContain('ООО «Ромашка»');
    expect(html).not.toContain('по заказу');
  });

  it('текстовая версия повторяет письмо без вёрстки', () => {
    const text = orgDocumentSentText(base);
    expect(text).toContain('счёт № с-2026-17');
    expect(text).toContain('по заказу № ON-1');
    expect(text).toContain('https://lk.test/organization/documents/doc-1');
  });

  it('текстовая версия документа вне заказа — без заказа', () => {
    const text = orgDocumentSentText({ ...base, orderNumber: null, orderTitle: null });
    expect(text).not.toContain('по заказу');
  });
});
