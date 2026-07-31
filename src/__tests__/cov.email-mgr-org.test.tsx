import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  ManagerDocumentUploadedByOrg,
  managerDocumentUploadedByOrgText,
  ManagerDocumentUploadedByPartner,
  managerDocumentUploadedByPartnerSubject,
  managerDocumentUploadedByPartnerText,
  ManagerInviteTemplate,
  managerInviteSubject,
  managerInviteText,
  OrgDocumentPublishedTemplate,
  orgDocumentPublishedSubject,
  orgDocumentPublishedText,
  OrgManagerRepliedTemplate,
  orgManagerRepliedSubject,
  orgManagerRepliedText,
  OrgOrderStatusChangedTemplate,
  orgOrderStatusChangedSubject,
  orgOrderStatusChangedText,
  OrgInviteTemplate,
  orgInviteText,
  OrgPaymentReceivedTemplate,
  orgPaymentReceivedSubject,
  orgPaymentReceivedText,
} from '@/lib/email/templates';

// ---------------------------------------------------------------------------
// manager/document-uploaded-by-org.tsx — DOC_TYPE_LABELS `?? 'документ'` branch
// ---------------------------------------------------------------------------
describe('ManagerDocumentUploadedByOrg — unknown documentType fallback', () => {
  it('component falls back to "документ" for an unknown documentType', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerDocumentUploadedByOrg, {
        orgName: 'ООО Орг',
        orderNumber: 'O-9',
        documentName: 'mystery.bin',
        documentType: 'totally_unknown',
        orderUrl: 'https://app.test/manager/orders/9',
      })
    );
    // No known label matched → generic 'документ' between "загрузила" and doc name.
    expect(html).toContain('загрузила документ');
    expect(html).toContain('mystery.bin');
    expect(html).toContain('№ O-9');
  });

  it('text falls back to "документ" for an unknown documentType', () => {
    const text = managerDocumentUploadedByOrgText({
      orgName: 'ООО Орг',
      orderNumber: 'O-9',
      documentName: 'mystery.bin',
      documentType: 'totally_unknown',
      orderUrl: 'https://u',
    });
    expect(text).toContain('загрузила документ «mystery.bin»');
    expect(text).toContain('https://u');
  });
});

// ---------------------------------------------------------------------------
// manager/document-uploaded-by-partner.tsx — never tested before (L58 B66)
// ---------------------------------------------------------------------------
describe('ManagerDocumentUploadedByPartner', () => {
  it('component renders known documentType label + partner + order + CTA', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerDocumentUploadedByPartner, {
        partnerName: 'ИП Партнёров',
        orderNumber: 'O-321',
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'https://app.test/manager/orders/321',
      })
    );
    expect(html).toContain('ИП Партнёров');
    expect(html).toContain('акт'); // known label for 'act'
    expect(html).toContain('act.pdf');
    expect(html).toContain('№ O-321');
    expect(html).toContain('https://app.test/manager/orders/321');
    expect(html).toContain('Открыть заказ');
  });

  it('component falls back to "документ" for an unknown documentType', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerDocumentUploadedByPartner, {
        partnerName: 'ИП Партнёров',
        orderNumber: 'O-321',
        documentName: 'x.bin',
        documentType: 'nope',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('загрузил документ');
    expect(html).toContain('x.bin');
  });

  it('subject formats partner, document, order', () => {
    expect(
      managerDocumentUploadedByPartnerSubject({
        partnerName: 'ИП Партнёров',
        orderNumber: 'O-321',
        documentName: 'act.pdf',
        documentType: 'act',
        orderUrl: 'u',
      })
    ).toBe('ИП Партнёров загрузил документ act.pdf к заказу № O-321');
  });

  it('text renders known label for a known documentType', () => {
    const text = managerDocumentUploadedByPartnerText({
      partnerName: 'ИП Партнёров',
      orderNumber: 'O-321',
      documentName: 'act.pdf',
      documentType: 'act',
      orderUrl: 'https://u',
    });
    expect(text).toContain('Партнёр ИП Партнёров загрузил акт «act.pdf» к заказу № O-321.');
    expect(text).toContain('https://u');
  });

  it('text falls back to "документ" for an unknown documentType', () => {
    const text = managerDocumentUploadedByPartnerText({
      partnerName: 'ИП Партнёров',
      orderNumber: 'O-321',
      documentName: 'x.bin',
      documentType: 'nope',
      orderUrl: 'https://u',
    });
    expect(text).toContain('загрузил документ «x.bin»');
  });
});

// ---------------------------------------------------------------------------
// manager/invite.tsx — component never rendered (F0) + text/subject
// ---------------------------------------------------------------------------
describe('ManagerInviteTemplate', () => {
  it('component renders with invitedByName (ternary → truthy branch)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerInviteTemplate, {
        organizationName: 'ООО Тест',
        inviteUrl: 'https://app.test/reset?token=mgr',
        invitedByName: 'Пётр',
      })
    );
    expect(html).toContain('Пётр приглашает вас');
    expect(html).toContain('ООО Тест');
    expect(html).toContain('кабинет менеджера');
    expect(html).toContain('Установить пароль');
    expect(html).toContain('https://app.test/reset?token=mgr');
  });

  it('component renders without invitedByName (ternary → falsy branch)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ManagerInviteTemplate, {
        organizationName: 'ООО Тест',
        inviteUrl: 'https://app.test/reset?token=mgr',
      })
    );
    expect(html).toContain('Вас приглашают');
    expect(html).not.toContain('приглашает вас');
  });

  it('subject includes organization name', () => {
    expect(managerInviteSubject('ООО Тест')).toBe('Приглашение в кабинет менеджера «ООО Тест»');
  });

  it('text uses named-inviter intro when invitedByName present', () => {
    const text = managerInviteText({
      organizationName: 'ООО Тест',
      inviteUrl: 'https://u',
      invitedByName: 'Пётр',
    });
    expect(text).toContain('Пётр приглашает вас');
    expect(text).toContain('организация «ООО Тест»');
    expect(text).toContain('https://u');
  });

  it('text uses impersonal intro when invitedByName absent', () => {
    const text = managerInviteText({
      organizationName: 'ООО Тест',
      inviteUrl: 'https://u',
    });
    expect(text).toContain('Вас приглашают');
    expect(text).not.toContain('приглашает вас');
  });
});

// ---------------------------------------------------------------------------
// organization/document-published.tsx — three-way orderLabel + label fallback
// ---------------------------------------------------------------------------
describe('OrgDocumentPublishedTemplate — orderLabel & typeLabel branches', () => {
  it('component: orderNumber null + orderTitle null → "(без заказа)" and unknown type fallback', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgDocumentPublishedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: null,
        orderTitle: null,
        documentName: 'weird.dat',
        documentType: 'unknown_kind',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('(без заказа)');
    expect(html).toContain('weird.dat');
    // Unknown type → 'документ' fallback rendered before the doc name.
    expect(html).toContain('загружен документ');
  });

  it('subject: falls to "(без заказа)" when both orderNumber and orderTitle are null', () => {
    expect(
      orgDocumentPublishedSubject({
        organizationName: 'X',
        orderNumber: null,
        orderTitle: null,
        documentName: 'd',
        documentType: 'other',
        orderUrl: 'u',
      })
    ).toBe('Новый документ по заказу (без заказа)');
  });

  it('text: prefers orderNumber label + known type label', () => {
    const text = orgDocumentPublishedText({
      organizationName: 'ООО Тест',
      orderNumber: '555',
      orderTitle: 'T',
      documentName: 'contract.pdf',
      documentType: 'contract',
      orderUrl: 'https://u',
    });
    expect(text).toContain('По заказу № 555 (ООО Тест) загружен договор: «contract.pdf».');
    expect(text).toContain('https://u');
  });

  it('text: falls back to orderTitle label + unknown type fallback', () => {
    const text = orgDocumentPublishedText({
      organizationName: 'ООО Тест',
      orderNumber: null,
      orderTitle: 'Курс',
      documentName: 'x.dat',
      documentType: 'mystery',
      orderUrl: 'https://u',
    });
    expect(text).toContain('По заказу «Курс» (ООО Тест) загружен документ: «x.dat».');
  });

  it('text: falls back to "(без заказа)" when both are null', () => {
    const text = orgDocumentPublishedText({
      organizationName: 'ООО Тест',
      orderNumber: null,
      orderTitle: null,
      documentName: 'x.dat',
      documentType: 'other',
      orderUrl: 'https://u',
    });
    expect(text).toContain('По заказу (без заказа) (ООО Тест) загружен документ: «x.dat».');
  });
});

// ---------------------------------------------------------------------------
// organization/manager-replied.tsx — never rendered (F0) + both orderLabel arms
// ---------------------------------------------------------------------------
describe('OrgManagerRepliedTemplate', () => {
  it('component renders with orderNumber (ternary → number label)', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgManagerRepliedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '77',
        orderTitle: 'Курс',
        commentExcerpt: 'Договор готов, проверьте.',
        orderUrl: 'https://app.test/organization/orders/77',
      })
    );
    expect(html).toContain('№ 77');
    expect(html).toContain('ООО Тест');
    expect(html).toContain('Договор готов, проверьте.');
    expect(html).toContain('Открыть заказ');
    expect(html).toContain('https://app.test/organization/orders/77');
  });

  it('component renders with null orderNumber (ternary → title label)', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgManagerRepliedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: null,
        orderTitle: 'Курс по ОТ',
        commentExcerpt: 'Уточните дату.',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('«Курс по ОТ»');
    expect(html).toContain('Уточните дату.');
  });

  it('subject uses number label when orderNumber present', () => {
    expect(
      orgManagerRepliedSubject({
        organizationName: 'X',
        orderNumber: '77',
        orderTitle: 'Курс',
        commentExcerpt: '...',
        orderUrl: 'u',
      })
    ).toBe('Менеджер ответил по заказу № 77');
  });

  it('subject falls back to title label when orderNumber null', () => {
    expect(
      orgManagerRepliedSubject({
        organizationName: 'X',
        orderNumber: null,
        orderTitle: 'Курс',
        commentExcerpt: '...',
        orderUrl: 'u',
      })
    ).toBe('Менеджер ответил по заказу «Курс»');
  });

  it('text uses number label when orderNumber present', () => {
    const text = orgManagerRepliedText({
      organizationName: 'ООО Тест',
      orderNumber: '77',
      orderTitle: 'Курс',
      commentExcerpt: 'Договор готов.',
      orderUrl: 'https://u',
    });
    expect(text).toContain('по заказу № 77 (ООО Тест)');
    expect(text).toContain('«Договор готов.»');
    expect(text).toContain('https://u');
  });

  it('text falls back to title label when orderNumber null', () => {
    const text = orgManagerRepliedText({
      organizationName: 'ООО Тест',
      orderNumber: null,
      orderTitle: 'Курс',
      commentExcerpt: 'Уточните.',
      orderUrl: 'https://u',
    });
    expect(text).toContain('по заказу «Курс» (ООО Тест)');
  });
});

// ---------------------------------------------------------------------------
// organization/order-status-changed.tsx — status label fallbacks + null number
// ---------------------------------------------------------------------------
describe('OrgOrderStatusChangedTemplate — fallback & null-order branches', () => {
  it('component: execution dimension with unknown statuses → raw fallback, and null orderNumber → title label', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgOrderStatusChangedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: null,
        orderTitle: 'Курс',
        dimension: 'execution',
        oldStatus: 'weird_old',
        newStatus: 'weird_new',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('«Курс»'); // orderNumber null → title label
    expect(html).toContain('weird_old'); // unknown execution status → raw
    expect(html).toContain('weird_new');
    expect(html).toContain('Статус заказа');
  });

  it('component: financial dimension with unknown statuses → raw fallback', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgOrderStatusChangedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: '42',
        orderTitle: 'X',
        dimension: 'financial',
        oldStatus: 'fin_old',
        newStatus: 'fin_new',
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('№ 42');
    expect(html).toContain('Финансовый статус');
    expect(html).toContain('fin_old');
    expect(html).toContain('fin_new');
  });

  it('subject: financial dimension + null orderNumber uses title label and raw status', () => {
    expect(
      orgOrderStatusChangedSubject({
        organizationName: 'X',
        orderNumber: null,
        orderTitle: 'Курс',
        dimension: 'financial',
        oldStatus: 'billed',
        newStatus: 'fin_new_raw',
        orderUrl: 'u',
      })
    ).toBe('Финансы заказа «Курс»: fin_new_raw');
  });

  it('text: financial dimension + null orderNumber, known financial labels', () => {
    const text = orgOrderStatusChangedText({
      organizationName: 'ООО Тест',
      orderNumber: null,
      orderTitle: 'Курс',
      dimension: 'financial',
      oldStatus: 'billed',
      newStatus: 'paid',
      orderUrl: 'https://u',
    });
    expect(text).toContain('По заказу «Курс» (ООО Тест) финансовый статус изменён:');
    expect(text).toContain('Счёт выставлен → Оплачен.');
    expect(text).toContain('https://u');
  });
});

// ---------------------------------------------------------------------------
// organization/org-invite.tsx — orgInviteText without invitedByName (falsy arm)
// ---------------------------------------------------------------------------
describe('org-invite text/component missing branches', () => {
  it('orgInviteText uses impersonal intro when invitedByName absent', () => {
    const text = orgInviteText({
      organizationName: 'ООО Тест',
      inviteUrl: 'https://u',
    });
    expect(text).toContain('Вас приглашают');
    expect(text).not.toContain('приглашает вас');
    expect(text).toContain('организации «ООО Тест»');
    expect(text).toContain('https://u');
  });

  it('OrgInviteTemplate renders with invitedByName (truthy arm, for completeness)', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgInviteTemplate, {
        organizationName: 'ООО Тест',
        inviteUrl: 'https://u',
        invitedByName: 'Мария',
      })
    );
    expect(html).toContain('Мария приглашает вас');
  });
});

// ---------------------------------------------------------------------------
// organization/payment-received.tsx — null orderNumber → title label (B62)
// ---------------------------------------------------------------------------
describe('OrgPaymentReceivedTemplate — null orderNumber branch', () => {
  it('component falls back to orderTitle label when orderNumber is null', () => {
    const html = renderToStaticMarkup(
      React.createElement(OrgPaymentReceivedTemplate, {
        organizationName: 'ООО Тест',
        orderNumber: null,
        orderTitle: 'Курс по ОТ',
        amount: '3000',
        paidAt: new Date('2026-05-26T12:00:00Z'),
        orderUrl: 'https://u',
      })
    );
    expect(html).toContain('«Курс по ОТ»');
    expect(html).toMatch(/3\s000\s?₽/);
    expect(html).toContain('https://u');
  });

  it('subject falls back to orderTitle label when orderNumber is null', () => {
    const subject = orgPaymentReceivedSubject({
      organizationName: 'X',
      orderNumber: null,
      orderTitle: 'Курс',
      amount: '3000',
      paidAt: new Date(),
      orderUrl: 'u',
    });
    expect(subject).toMatch(/^Оплата .+ по заказу «Курс»$/);
  });

  it('text falls back to orderTitle label when orderNumber is null', () => {
    const text = orgPaymentReceivedText({
      organizationName: 'ООО Тест',
      orderNumber: null,
      orderTitle: 'Курс',
      amount: '100',
      paidAt: new Date('2026-05-26T00:00:00Z'),
      orderUrl: 'https://u',
    });
    expect(text).toContain('по заказу «Курс» (ООО Тест)');
    expect(text).toContain('100 ₽');
    expect(text).toContain('https://u');
  });
});
