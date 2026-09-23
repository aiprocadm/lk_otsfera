import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import type { AuditLog, Payment } from '@prisma/client';

/**
 * Прогон сопровождения №36, группа А спеки
 * `2026-09-23-moscow-time-in-server-code-design`: показ дат — по Москве.
 *
 * Тесты идут в UTC, как и сервер. Поэтому каждый случай берёт момент
 * «00:30 по Москве 10.09» — это ещё 21:30 09.09 по Гринвичу. Формат без
 * `timeZone` напечатал бы «09.09.2026» (так и было в PDF, письмах, выгрузке и
 * серверной отрисовке экранов), а человек в Москве ждёт «10.09.2026».
 * Страж `dates.moscow-display` держит правило по тексту исходников; здесь —
 * поведение там, где дату печатает сервер.
 */
const EDGE = new Date('2026-09-09T21:30:07.000Z');
const DAY = '10.09.2026';
const UTC_DAY = '09.09.2026';

const { captured } = vi.hoisted(() => ({ captured: [] as unknown[] }));

vi.mock('@react-pdf/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-pdf/renderer')>();
  return {
    ...actual,
    // Сжатый PDF текста не покажет — ловим разметку, которую отдали в рендер.
    renderToBuffer: vi.fn(async (el: unknown) => {
      captured.push(el);
      return Buffer.from('%PDF-');
    }),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server-actions/admin/users', () => ({
  deactivateUserFormAction: vi.fn(),
  reactivateUserFormAction: vi.fn(),
}));
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction: vi.fn() }));

import { formatDateRu } from '@/lib/services/export/xlsx';
import { formatAuditDateTime } from '@/lib/audit/labels';
import {
  ManagerOrderMarkedPaidBy1C,
  managerOrderMarkedPaidBy1CText,
  OrgPaymentReceivedTemplate,
  orgPaymentReceivedText,
} from '@/lib/email/templates';
import {
  OrderDocumentPdf,
  type OrderDocumentData,
} from '@/lib/services/documents/orderDocumentPdf';
import {
  renderContractDocumentPdf,
  type ContractDocumentData,
} from '@/lib/services/documents/contractDocumentPdf';
import {
  renderProposalDocumentPdf,
  type ProposalDocumentData,
} from '@/lib/services/documents/proposalDocumentPdf';
import { buildPrintTable } from '@/lib/services/documents/printTable';
import { ManagerPaymentsList } from '@/components/manager/manager-payments-list';
import { ManagerOrderTimeline } from '@/components/manager/manager-order-timeline';
import { OrgPaymentsList } from '@/components/organization/org-payments-list';
import { OrgOrderTimeline } from '@/components/organization/org-order-timeline';
import { OrgOrdersTable } from '@/components/organization/org-orders-table';
import { OrderTimeline } from '@/components/partner/order-timeline';
import { OrderComments } from '@/components/partner/order-comments';
import { PartnerOrdersTable } from '@/components/partner/orders-table';
import { PartnerOrdersCardList } from '@/components/partner/orders-card-list';
import { PiiAccessTable } from '@/components/admin/pii-access-table';
import { UsersTable } from '@/components/admin/users-table';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';
import type { OrgOrderDetail, OrgOrderRow } from '@/lib/services/organization/orders';
import type { PartnerOrderDetail } from '@/lib/services/partner/orderDetail';
import type { PartnerOrderRow } from '@/lib/services/partner/orders';
import type { PiiAccessRow } from '@/lib/services/admin/piiAccess';

/** Текст документа react-pdf: обход дерева с раскрытием компонентов. */
function pdfText(node: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const el = n as { type?: unknown; props?: { children?: unknown } };
    if (typeof el.type === 'function') {
      walk((el.type as (p: unknown) => unknown)(el.props));
      return;
    }
    walk(el.props?.children);
  };
  walk(node);
  return out.join(' ');
}

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, '');

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
  signerBasis: 'Устава',
};

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
const NO_BRANDING = { logo: null, signature: null, stamp: null };

describe('даты по Москве там, где их печатает сервер (прогон №36)', () => {
  it('выгрузка XLSX: дата записи в 00:30 по Москве — московским днём', () => {
    expect(formatDateRu(EDGE)).toBe(DAY);
  });

  it('журнал аудита: время по Москве, с секундами', () => {
    expect(formatAuditDateTime(EDGE)).toBe(`${DAY} 00:30:07`);
  });

  it('письма об оплате: дата платежа — московская, и в HTML, и в тексте', () => {
    const org = {
      organizationName: 'ООО «Ромашка»',
      orderNumber: '2026-118',
      orderTitle: 'Обучение по охране труда',
      amount: '45000',
      paidAt: EDGE,
      orderUrl: 'https://lk.example.ru/organization/orders/o1',
    };
    expect(renderToStaticMarkup(<OrgPaymentReceivedTemplate {...org} />)).toContain(DAY);
    expect(orgPaymentReceivedText(org)).toContain(`от ${DAY}`);

    const mgr = {
      orderNumber: '2026-118',
      amount: 45000,
      paidAt: EDGE,
      orderUrl: 'https://lk.example.ru/manager/orders/o1',
    };
    expect(renderToStaticMarkup(<ManagerOrderMarkedPaidBy1C {...mgr} />)).toContain(DAY);
    expect(managerOrderMarkedPaidBy1CText(mgr)).toContain(`от ${DAY}`);
  });

  it('счёт и акт: дата документа и период услуг — по Москве', () => {
    // Дата документа по умолчанию — московская полночь (`startOfMoscowDay`):
    // 21:00 по Гринвичу накануне. Без пояса счёт печатался вчерашним числом.
    const data: OrderDocumentData = {
      docType: 'act',
      number: 'А-2026-17',
      date: new Date('2026-09-09T21:00:00.000Z'),
      company: PARTY,
      organization: { ...PARTY, displayName: 'ООО «Ромашка»' },
      // Акт без заказа (`У-145`) — подзаголовка нет, дата от этого не зависит.
      orderLabel: null,
      table: TABLE,
      branding: NO_BRANDING,
      servicePeriod: { from: EDGE, to: new Date('2026-09-30T20:59:59.999Z') },
      draftNote: null,
    };
    const text = pdfText(OrderDocumentPdf({ data }));
    expect(text).toContain(`от ${DAY}`);
    expect(text).toContain(`Период оказания услуг: ${DAY} — 30.09.2026`);
    expect(text).not.toContain(UTC_DAY);
  });

  it('доп. соглашение: своя дата и дата договора-основания — по Москве', async () => {
    captured.length = 0;
    const data: ContractDocumentData = {
      docType: 'extra_agreement',
      number: 'ДС-2026-4',
      date: EDGE,
      company: PARTY,
      organization: { ...PARTY, displayName: 'ООО «Ромашка»' },
      clauses: [],
      table: TABLE,
      branding: NO_BRANDING,
      baseContract: { number: 'Д-2026-4', date: new Date('2026-06-30T21:00:00.000Z') },
      draftNote: null,
    };
    await renderContractDocumentPdf(data);
    const text = pdfText(captured[0]);
    expect(text).toContain(DAY);
    expect(text).toContain('к договору № Д-2026-4 от 01.07.2026');
    expect(text).not.toContain(UTC_DAY);
  });

  it('коммерческое предложение: дата и «Срок действия» — по Москве', async () => {
    captured.length = 0;
    const data: ProposalDocumentData = {
      number: 'КП-2026-4',
      date: EDGE,
      validUntil: new Date('2026-09-23T21:00:00.000Z'),
      company: PARTY,
      addressee: { name: 'ООО «Ромашка»', contactName: 'Иван Петров' },
      clauses: [],
      table: TABLE,
      branding: NO_BRANDING,
      manager: { name: 'Мария Смирнова', email: 'm.smirnova@pts.ru', phone: '+7 495 000-00-00' },
      draftNote: null,
    };
    await renderProposalDocumentPdf(data);
    const text = pdfText(captured[0]);
    expect(text).toContain(`от ${DAY}`);
    expect(text).toContain('Срок действия: до 24.09.2026');
  });
});

describe('экраны, которые рисует сервер: тот же день, что увидит браузер (прогон №36)', () => {
  it('оплаты заказа у менеджера и у заказчика', () => {
    const payment = {
      id: 'p1',
      amount: '45000.00',
      paidAt: EDGE,
      method: 'bank',
      isRefund: false,
      note: null,
      orderId: 'o1',
    } as unknown as Payment;
    expect(html(<ManagerPaymentsList payments={[payment]} />)).toContain(DAY);
    expect(
      html(
        <OrgPaymentsList
          payments={[
            {
              id: 'p1',
              amount: '45000.00',
              paidAt: EDGE,
              method: 'bank',
              isRefund: false,
              note: null,
            },
          ]}
        />
      )
    ).toContain(DAY);
  });

  it('хронология заказа у менеджера: веха по дню, запись журнала и «Обновлено из 1С» — со временем', () => {
    const order = {
      createdAt: EDGE,
      contractSignedAt: null,
      deadline: null,
      completedAt: null,
      paidAt: null,
      closedAt: null,
      lastSyncedAt: EDGE,
    } as ManagerOrderDetail;
    const audit = {
      id: 'a1',
      action: 'order_status_changed',
      createdAt: EDGE,
      meta: {},
    } as unknown as AuditLog;
    const out = html(<ManagerOrderTimeline order={order} auditEntries={[audit]} />);
    expect(out).toContain(`Обновлено из 1С: ${DAY}, 00:30`);
    expect(out).not.toContain(UTC_DAY);
  });

  it('хронология заказа у заказчика и у партнёра', () => {
    const common = {
      createdAt: EDGE,
      deadline: null,
      contractSignedAt: null,
      completedAt: null,
      closedAt: null,
      paidAt: null,
      lastSyncedAt: EDGE,
    };
    const orgOut = html(<OrgOrderTimeline order={common as unknown as OrgOrderDetail} />);
    expect(orgOut).toContain(DAY);
    expect(orgOut).toContain(`${DAY}, 00:30`);
    expect(orgOut).not.toContain(UTC_DAY);

    const partnerOut = html(<OrderTimeline deal={common as unknown as PartnerOrderDetail} />);
    expect(partnerOut).toContain(`${DAY}, 00:30`);
    expect(partnerOut).not.toContain(UTC_DAY);
  });

  it('комментарии к заказу у партнёра — со временем по Москве', () => {
    const out = html(
      <OrderComments
        orderId="o1"
        comments={[{ id: 'c1', body: 'Счёт получили', createdAt: EDGE, authorName: 'Иван Петров' }]}
      />
    );
    expect(out).toContain(`${DAY}, 00:30`);
  });

  it('списки заказов: короткий год тоже московский', () => {
    const partnerRow = {
      id: 'd1',
      orderNumber: 'A-1',
      title: 'Заказ X',
      totalAmount: '1000.00',
      paidAmount: '0.00',
      debt: '1000.00',
      executionStatus: 'pending',
      financialStatus: 'not_billed',
      stage: { label: 'Новый', tone: 'neutral' },
      organizationName: 'ООО Ромашка',
      organizationId: 'o1',
      createdAt: EDGE,
      deadline: EDGE,
      closedAt: null,
    } as PartnerOrderRow;
    expect(html(<PartnerOrdersTable rows={[partnerRow]} />)).toContain('10.09.26');
    expect(html(<PartnerOrdersCardList rows={[partnerRow]} />)).toContain('10.09.26');
    const orgRow = { ...partnerRow, organizationId: 'org1' } as unknown as OrgOrderRow;
    expect(html(<OrgOrdersTable rows={[orgRow]} orgParam={null} />)).toContain('10.09.26');
  });

  it('журнал доступа к ПДн и список пользователей', () => {
    const pii: PiiAccessRow = {
      id: 'ev1',
      createdAt: EDGE,
      actor: { id: 'u1', email: 'e@x.ru', name: 'Емп Ловеев' },
      userRole: 'manager',
      context: 'global_search_students',
      labelRu: 'Глобальный поиск: слушатели',
      action: 'list',
      subjectType: 'student',
      subjectCount: 1,
      subjects: [{ id: 's1', label: 'Иван И.' }],
      meta: null,
    } as PiiAccessRow;
    expect(html(<PiiAccessTable rows={[pii]} />)).toContain(`${DAY}, 00:30:07`);

    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Тест Пользователь',
      role: 'partner' as const,
      isActive: true,
      createdAt: EDGE,
      attachmentLabel: 'ООО Партнёр',
      invitePending: false,
      lastLoginAt: null,
    };
    expect(html(<UsersTable rows={[user]} currentUserId="me" />)).toContain(DAY);
  });
});
