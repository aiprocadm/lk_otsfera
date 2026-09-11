// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateOrderDocumentAction, requestRequisitesAction } = vi.hoisted(() => ({
  generateOrderDocumentAction: vi.fn(),
  requestRequisitesAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/generate', () => ({
  generateOrderDocumentAction,
  requestRequisitesAction,
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GenerateDocumentsPanel } from '@/components/manager/generate-documents-panel';
import type { IssueDocType, IssueLine } from '@/components/manager/issue-document-dialog';
import {
  listMissingRequisites,
  type MissingRequisite,
  type PartyRequisites,
  type RequisitesDocKind,
} from '@/lib/documents/requisites-check';

/**
 * ФТ-9.5 / `У-157`: рядом с погашенной кнопкой выпуска стоит действие
 * «Запросить у клиента» — письмо со списком недостающего.
 *
 * До этого стража кнопка решала ПО ОДНОМУ СЧЁТУ. Пока набор реквизитов был
 * общим на все документы, это совпадало; `У-156` развёл наборы по типам — и
 * договору дополнительно понадобились подписант заказчика, его должность и
 * основание полномочий. У заказчика с полными реквизитами счёта, но без
 * подписанта договор выпустить было нельзя, а попросить эти реквизиты —
 * нечем: кнопка не появлялась ни на панели, ни в форме выпуска. Само письмо
 * их спрашивать умело (`requestRequisites` собирает недостающее и по счёту, и
 * по договору) — механизм был построен, но его ничто не запускало.
 *
 * Страж держит обещание по КАЖДОМУ типу, который панель умеет выпускать, а не
 * по одному счёту: наборы разъедутся снова — тест упадёт.
 */
const FULL: PartyRequisites = {
  name: 'Раб',
  legalName: 'ООО «Тест»',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700132195',
  legalAddress: 'Москва',
  bankName: 'Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов',
  signerPosition: 'Директор',
  signerBasis: 'Устава',
};

const ALL_KINDS: RequisitesDocKind[] = [
  'invoice',
  'act',
  'contract',
  'extra_agreement',
  'commercial_proposal',
];

/** Наборы недостающего по типам — теми же правилами, что у сервера. */
function missingByType(org: Partial<PartyRequisites>): Record<IssueDocType, MissingRequisite[]> {
  const organization = { ...FULL, ...org };
  return Object.fromEntries(
    ALL_KINDS.map((kind) => [kind, listMissingRequisites(FULL, organization, kind)])
  ) as Record<IssueDocType, MissingRequisite[]>;
}

const LINE: IssueLine = {
  title: 'Обучение',
  quantity: '1',
  unit: 'person',
  unitPrice: '5000',
  discountPercent: null,
  vatRate: '0.2000',
  vatIncluded: true,
};

function panel(missing: Record<IssueDocType, MissingRequisite[]>) {
  return render(
    <GenerateDocumentsPanel
      orderId="ord-1"
      counterpartyName="ООО «Ромашка»"
      orderLines={[LINE]}
      missingByType={missing}
      baseDocuments={[]}
      hasInvoice={false}
      hasContract={false}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

/**
 * Типы, которые панель заказа предлагает выпустить, и дыра у заказчика,
 * которая именно этот тип блокирует. Счёт и акт делят один набор, договор и
 * доп. соглашение — другой: проверяем все четыре, чтобы обещание не держалось
 * на одном счёте.
 */
const CASES: Array<{ kind: IssueDocType; org: Partial<PartyRequisites>; label: string }> = [
  { kind: 'invoice', org: { inn: null }, label: 'ИНН заказчика' },
  { kind: 'act', org: { legalAddress: null }, label: 'юр. адрес заказчика' },
  { kind: 'contract', org: { signerName: null }, label: 'подписант заказчика (ФИО)' },
  {
    kind: 'extra_agreement',
    org: { signerBasis: null },
    label: 'основание полномочий заказчика',
  },
];

describe('ФТ-9.5: попросить недостающее у клиента можно для КАЖДОГО типа документа', () => {
  it.each(CASES)(
    'не хватает реквизитов для «$kind» — на панели есть «Запросить у клиента»',
    ({ org, label }) => {
      panel(missingByType(org));

      const block = screen.getByTestId('missing-requisites');
      expect(
        within(block).getByText(label),
        'недостающий реквизит не назван на экране'
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Запросить у клиента' }),
        'нечем попросить недостающее у клиента'
      ).toBeTruthy();
    }
  );

  it('у заказчика всё заполнено — просить нечего, блока нет', () => {
    panel(missingByType({}));
    expect(screen.queryByTestId('missing-requisites')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Запросить у клиента' })).toBeNull();
  });

  it('дыры только у исполнителя — клиенту писать не о чем', () => {
    const missing = Object.fromEntries(
      ALL_KINDS.map((kind) => [
        kind,
        listMissingRequisites({ ...FULL, bic: null }, FULL, kind).filter(
          (m) => m.side === 'company'
        ),
      ])
    ) as Record<IssueDocType, MissingRequisite[]>;
    panel(missing);
    expect(screen.queryByRole('button', { name: 'Запросить у клиента' })).toBeNull();
    expect(screen.getByText(/Реквизиты исполнителя заполняются/)).toBeTruthy();
  });
});
