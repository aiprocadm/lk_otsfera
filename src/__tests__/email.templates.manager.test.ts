import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  ManagerCommentFromOrg,
  managerCommentFromOrgSubject,
  managerCommentFromOrgText,
  ManagerDocumentUploadedByOrg,
  managerDocumentUploadedByOrgSubject,
  ManagerOrderMarkedPaidBy1C,
  managerOrderMarkedPaidBy1CSubject,
  managerOrderMarkedPaidBy1CText,
  ManagerOrderStatusChanged,
  managerOrderStatusChangedSubject,
  managerOrderStatusChangedText
} from '@/lib/email/templates';

describe('manager email templates — render smoke', () => {
  it('ManagerCommentFromOrg renders org name, order number, excerpt, and CTA url', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerCommentFromOrg, {
        orgName: 'ООО Тест',
        orderNumber: 'O-001',
        commentExcerpt: 'Когда будет готов договор?',
        orderUrl: 'https://app.test/manager/orders/abc'
      })
    );
    expect(html).toContain('ООО Тест');
    expect(html).toContain('№ O-001');
    expect(html).toContain('Когда будет готов договор?');
    expect(html).toContain('https://app.test/manager/orders/abc');
    expect(html).toContain('Открыть заказ');
    expect(html).toContain('#F97316');
  });

  it('managerCommentFromOrgSubject formats subject', () => {
    expect(
      managerCommentFromOrgSubject({
        orgName: 'ООО Тест',
        orderNumber: 'O-001',
        commentExcerpt: '...',
        orderUrl: 'u'
      })
    ).toBe('Новое сообщение от ООО Тест по заказу № O-001');
  });

  it('managerCommentFromOrgText includes excerpt and link', () => {
    const text = managerCommentFromOrgText({
      orgName: 'ООО Тест',
      orderNumber: 'O-001',
      commentExcerpt: 'Хочу уточнить срок.',
      orderUrl: 'https://u'
    });
    expect(text).toContain('Хочу уточнить срок.');
    expect(text).toContain('https://u');
  });

  it('ManagerDocumentUploadedByOrg renders document name, type label, and CTA', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerDocumentUploadedByOrg, {
        orgName: 'ACME',
        orderNumber: 'O-77',
        documentName: 'signed-contract.pdf',
        documentType: 'contract',
        orderUrl: 'https://app.test/manager/orders/xyz'
      })
    );
    expect(html).toContain('ACME');
    expect(html).toContain('№ O-77');
    expect(html).toContain('signed-contract.pdf');
    expect(html).toContain('договор');
    expect(html).toContain('https://app.test/manager/orders/xyz');
    expect(html).toContain('Открыть заказ');
  });

  it('managerDocumentUploadedByOrgSubject contains org, doc, and order ref', () => {
    expect(
      managerDocumentUploadedByOrgSubject({
        orgName: 'ACME',
        orderNumber: 'O-77',
        documentName: 'signed.pdf',
        documentType: 'contract',
        orderUrl: 'u'
      })
    ).toBe('ACME загрузил документ signed.pdf к заказу № O-77');
  });

  it('ManagerOrderMarkedPaidBy1C formats amount and date in ru-RU', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerOrderMarkedPaidBy1C, {
        orderNumber: 'O-555',
        amount: 125000,
        paidAt: new Date('2026-05-26T12:00:00Z'),
        orderUrl: 'https://app.test/manager/orders/p555'
      })
    );
    // ru-RU group separator varies by Node ICU (NBSP   or narrow NBSP  );
    // match any whitespace between digit groups to stay portable.
    expect(html).toMatch(/125\s000\s?₽/);
    expect(html).toContain('№ O-555');
    expect(html).toContain('https://app.test/manager/orders/p555');
    expect(html).toContain('Открыть заказ');
  });

  it('managerOrderMarkedPaidBy1CSubject includes amount and order number', () => {
    expect(
      managerOrderMarkedPaidBy1CSubject({
        orderNumber: 'O-555',
        amount: 50000,
        paidAt: new Date(),
        orderUrl: 'u'
      })
    ).toMatch(/^Получена оплата .+ по заказу № O-555$/);
  });

  it('managerOrderMarkedPaidBy1CText includes amount and link', () => {
    const text = managerOrderMarkedPaidBy1CText({
      orderNumber: 'O-1',
      amount: 100,
      paidAt: new Date('2026-05-26T00:00:00Z'),
      orderUrl: 'https://u'
    });
    expect(text).toContain('100 ₽');
    expect(text).toContain('https://u');
    expect(text).toContain('1С');
  });

  it('ManagerOrderStatusChanged renders actor, statuses, and CTA', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerOrderStatusChanged, {
        orderNumber: 'O-42',
        actorName: 'Иван Иванов',
        oldStatus: 'В работе',
        newStatus: 'Завершён',
        orderUrl: 'https://app.test/manager/orders/42'
      })
    );
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('№ O-42');
    expect(html).toContain('В работе');
    expect(html).toContain('Завершён');
    expect(html).toContain('https://app.test/manager/orders/42');
    expect(html).toContain('Открыть заказ');
  });

  it('managerOrderStatusChangedSubject mentions actor and new status', () => {
    expect(
      managerOrderStatusChangedSubject({
        orderNumber: 'O-42',
        actorName: 'Иван Иванов',
        oldStatus: 'В работе',
        newStatus: 'Завершён',
        orderUrl: 'u'
      })
    ).toBe('Менеджер Иван Иванов перевёл заказ № O-42 в Завершён');
  });

  it('managerOrderStatusChangedText shows transition and link', () => {
    const text = managerOrderStatusChangedText({
      orderNumber: 'O-42',
      actorName: 'Иван',
      oldStatus: 'В работе',
      newStatus: 'На паузе',
      orderUrl: 'https://u'
    });
    expect(text).toContain('В работе → На паузе');
    expect(text).toContain('https://u');
  });
});
