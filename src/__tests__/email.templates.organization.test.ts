import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  OrgInviteTemplate,
  orgInviteSubject,
  orgInviteText,
  OrgDocumentPublishedTemplate,
  orgDocumentPublishedSubject,
  OrgPaymentReceivedTemplate,
  orgPaymentReceivedSubject,
  orgPaymentReceivedText,
  OrgOrderStatusChangedTemplate,
  orgOrderStatusChangedSubject,
  orgOrderStatusChangedText,
} from '@/lib/email/templates';

describe('organization email templates — render smoke', () => {
  it('OrgInviteTemplate renders org name, button, and url', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgInviteTemplate, {
        organizationName: 'ООО Тест',
        inviteUrl: 'https://app.test/reset?token=abc',
        invitedByName: 'Андрей',
      })
    );
    expect(html).toContain('ООО Тест');
    expect(html).toContain('Установить пароль');
    expect(html).toContain('https://app.test/reset?token=abc');
    expect(html).toContain('Андрей');
  });

  it('OrgInviteTemplate works without invitedByName', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgInviteTemplate, {
        organizationName: 'ООО Тест',
        inviteUrl: 'https://app.test/reset?token=abc',
      })
    );
    expect(html).toContain('Вас приглашают');
    expect(html).not.toContain('Андрей');
  });

  it('orgInviteSubject includes the organization name', () => {
    expect(orgInviteSubject('ООО Тест')).toBe('Приглашение в кабинет «ООО Тест»');
  });

  it('orgInviteText includes link and intro', () => {
    const text = orgInviteText({
      organizationName: 'ООО Тест',
      inviteUrl: 'https://app.test/x',
      invitedByName: 'Андрей',
    });
    expect(text).toContain('Андрей приглашает вас');
    expect(text).toContain('https://app.test/x');
  });

  it('OrgDocumentPublishedTemplate renders document and order info', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgDocumentPublishedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '12345',
        orderTitle: 'Курс по охране труда',
        documentName: 'contract.pdf',
        documentType: 'contract',
        orderUrl: 'https://app.test/organization/orders/abc',
      })
    );
    expect(html).toContain('№ 12345');
    expect(html).toContain('договор');
    expect(html).toContain('contract.pdf');
    expect(html).toContain('https://app.test/organization/orders/abc');
  });

  it('OrgDocumentPublishedTemplate falls back to orderTitle when orderNumber is null', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgDocumentPublishedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: null,
        orderTitle: 'Курс по охране труда',
        documentName: 'a.pdf',
        documentType: 'act',
        orderUrl: 'https://app.test/x',
      })
    );
    expect(html).toContain('«Курс по охране труда»');
    expect(html).toContain('акт');
  });

  it('orgDocumentPublishedSubject prefers orderNumber, falls back to title', () => {
    expect(
      orgDocumentPublishedSubject({
        organizationName: 'X',
        orderNumber: '999',
        orderTitle: 'T',
        documentName: 'd',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ по заказу № 999');

    expect(
      orgDocumentPublishedSubject({
        organizationName: 'X',
        orderNumber: null,
        orderTitle: 'T',
        documentName: 'd',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ по заказу «T»');
  });

  it('OrgPaymentReceivedTemplate formats amount and date in ru-RU', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgPaymentReceivedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '777',
        orderTitle: 'X',
        amount: '125000',
        paidAt: new Date('2026-05-26T12:00:00Z'),
        orderUrl: 'https://app.test/order/777',
      })
    );
    expect(html).toContain('125 000 ₽'); // ru-RU uses non-breaking space
    expect(html).toContain('№ 777');
    expect(html).toContain('https://app.test/order/777');
  });

  it('orgPaymentReceivedSubject includes amount and order ref', () => {
    expect(
      orgPaymentReceivedSubject({
        organizationName: 'X',
        orderNumber: '777',
        orderTitle: 'T',
        amount: '50000',
        paidAt: new Date(),
        orderUrl: 'u',
      })
    ).toMatch(/^Оплата .+ по заказу № 777$/);
  });

  it('orgPaymentReceivedText includes amount, date, link', () => {
    const text = orgPaymentReceivedText({
      organizationName: 'X',
      orderNumber: '1',
      orderTitle: 'T',
      amount: '100',
      paidAt: new Date('2026-05-26T00:00:00Z'),
      orderUrl: 'https://u',
    });
    expect(text).toContain('100 ₽');
    expect(text).toContain('https://u');
  });

  it('OrgOrderStatusChangedTemplate renders execution dimension transition', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgOrderStatusChangedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '42',
        orderTitle: 'X',
        dimension: 'execution',
        oldStatus: 'in_progress',
        newStatus: 'completed',
        orderUrl: 'https://app.test/order/42',
      })
    );
    expect(html).toContain('В работе');
    expect(html).toContain('Завершён');
    expect(html).toContain('№ 42');
  });

  it('OrgOrderStatusChangedTemplate renders financial dimension transition', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgOrderStatusChangedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '42',
        orderTitle: 'X',
        dimension: 'financial',
        oldStatus: 'billed',
        newStatus: 'paid',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('Счёт выставлен');
    expect(html).toContain('Оплачен');
  });

  it('orgOrderStatusChangedSubject distinguishes Status vs Финансы', () => {
    expect(
      orgOrderStatusChangedSubject({
        organizationName: 'X',
        orderNumber: '1',
        orderTitle: 'T',
        dimension: 'execution',
        oldStatus: 'pending',
        newStatus: 'in_progress',
        orderUrl: 'u',
      })
    ).toMatch(/^Статус заказа № 1: В работе$/);

    expect(
      orgOrderStatusChangedSubject({
        organizationName: 'X',
        orderNumber: '1',
        orderTitle: 'T',
        dimension: 'financial',
        oldStatus: 'not_billed',
        newStatus: 'billed',
        orderUrl: 'u',
      })
    ).toMatch(/^Финансы заказа № 1: Счёт выставлен$/);
  });

  it('orgOrderStatusChangedText is human-readable', () => {
    const text = orgOrderStatusChangedText({
      organizationName: 'X',
      orderNumber: '1',
      orderTitle: 'T',
      dimension: 'execution',
      oldStatus: 'in_progress',
      newStatus: 'on_hold',
      orderUrl: 'https://u',
    });
    expect(text).toContain('В работе → На паузе');
    expect(text).toContain('https://u');
  });
});
