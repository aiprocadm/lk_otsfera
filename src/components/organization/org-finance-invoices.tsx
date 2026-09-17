import React from 'react';
import Link from 'next/link';
import {
  ORG_INVOICE_STATES,
  ORG_INVOICE_STATE_LABELS,
  type OrgInvoiceRow,
  type OrgInvoiceState,
  type OrgInvoicesResult,
} from '@/lib/services/organization/invoices';
import { TableShell, THead, Th, Tr, Td, EmptyState, Badge } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { OrgInvoiceDownloadButton } from '@/components/organization/org-invoice-download-button';
import { buttonClass } from '@/lib/ui/buttonClass';
import { fmtMoney, fmtDate } from '@/lib/format';

/**
 * Блок «Счета» в «Финансах» заказчика (этап 6, `У-235`).
 *
 * Только у заказчика: партнёр оплаты и задолженность клиента не видит —
 * записанное исключение зеркала (`MIRROR_BLOCK_EXCEPTIONS`, `Р-Э6-7`).
 * Фильтры — обычная GET-форма: адрес с фильтрами можно переслать бухгалтеру.
 * На телефоне таблица из восьми колонок становится карточками (`У-18`).
 */
const STATE_TONE: Record<OrgInvoiceState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  partially_paid: 'warning',
  unpaid: 'danger',
  unknown: 'neutral',
};

export type OrgInvoicesFilterView = {
  from?: string | undefined;
  to?: string | undefined;
  state?: OrgInvoiceState | undefined;
};

function StateBadge({ row }: { row: OrgInvoiceRow }) {
  const title = row.ambiguous
    ? 'Платёж назвал несколько счетов сразу — сумма по ним не разнесена'
    : row.state === 'unpaid' && !row.matched
      ? 'Ни один платёж не сослался на этот счёт'
      : undefined;
  const badge = <Badge tone={STATE_TONE[row.state]}>{ORG_INVOICE_STATE_LABELS[row.state]}</Badge>;
  // Подсказка — на обёртке: бейдж лишних атрибутов не пробрасывает.
  return title ? <span title={title}>{badge}</span> : badge;
}

function money(value: string | null): string {
  return value === null ? '—' : fmtMoney(value);
}

function orderCell(row: OrgInvoiceRow, orgId: string) {
  if (!row.orderId) return <span className="text-gray-400">—</span>;
  return (
    <Link
      href={`/organization/orders/${row.orderId}?org=${orgId}`}
      className="text-[#F97316] hover:underline"
    >
      {row.orderNumber ?? row.orderTitle ?? 'Заказ'}
    </Link>
  );
}

export function OrgFinanceInvoices({
  result,
  orgId,
  filter,
}: {
  result: OrgInvoicesResult;
  orgId: string;
  filter: OrgInvoicesFilterView;
}) {
  const filtered = Boolean(filter.from || filter.to || filter.state);
  const toPay = Number(result.toPay);
  const inputClass =
    'border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#F97316]';
  return (
    <section className="space-y-3" data-testid="org-invoices">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">Счета</h2>
          <p className="text-xs text-gray-500">
            Что выставлено и что из этого оплачено; оплата определяется по назначению платежа.
          </p>
        </div>
        <div className="text-sm" data-testid="org-invoices-to-pay">
          <span className="text-gray-500">К оплате: </span>
          <span
            className={toPay > 0 ? 'font-semibold text-red-700' : 'font-semibold text-gray-800'}
          >
            {fmtMoney(result.toPay)}
          </span>
        </div>
      </div>

      <form
        method="get"
        action="/organization/finance"
        className="flex flex-wrap items-end gap-2"
        data-testid="org-invoices-filter"
      >
        <input type="hidden" name="org" value={orgId} />
        <label className="text-xs text-gray-500">
          С
          <input
            type="date"
            name="from"
            defaultValue={filter.from ?? ''}
            className={`${inputClass} ml-1`}
          />
        </label>
        <label className="text-xs text-gray-500">
          По
          <input
            type="date"
            name="to"
            defaultValue={filter.to ?? ''}
            className={`${inputClass} ml-1`}
          />
        </label>
        <label className="text-xs text-gray-500">
          Состояние
          <select name="state" defaultValue={filter.state ?? ''} className={`${inputClass} ml-1`}>
            <option value="">Все ({result.total})</option>
            {ORG_INVOICE_STATES.map((s) => (
              <option key={s} value={s}>
                {ORG_INVOICE_STATE_LABELS[s]} ({result.counts[s]})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          Показать
        </button>
        {filtered && (
          <Link
            href={`/organization/finance?org=${orgId}`}
            className="text-sm text-gray-500 hover:underline"
          >
            Сбросить
          </Link>
        )}
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          message={
            filtered
              ? 'По выбранным фильтрам счетов нет — измените период или состояние.'
              : 'Счетов пока нет — они появятся здесь, как только менеджер выставит первый счёт.'
          }
        />
      ) : (
        <>
          <TableShell className="hidden md:block" overflow="x-auto">
            <THead>
              <Th>Дата</Th>
              <Th>Номер</Th>
              <Th>Заказ</Th>
              <Th className="text-right">Сумма</Th>
              <Th className="text-right">Оплачено</Th>
              <Th className="text-right">К оплате</Th>
              <Th>Состояние</Th>
              <Th>
                <span className="sr-only">Скачать</span>
              </Th>
            </THead>
            <tbody>
              {result.rows.map((r) => (
                <Tr key={r.id} data-testid={`invoice-row-${r.id}`}>
                  <Td className="text-gray-500">{fmtDate(r.issuedAt)}</Td>
                  <Td className="font-medium text-[#111111]">{r.number ?? r.name}</Td>
                  <Td>{orderCell(r, orgId)}</Td>
                  <Td className="text-right text-gray-800">{money(r.amountGross)}</Td>
                  <Td className="text-right text-gray-600">{money(r.paid)}</Td>
                  <Td
                    className={`text-right ${Number(r.due) > 0 ? 'font-medium text-red-700' : 'text-gray-500'}`}
                  >
                    {money(r.due)}
                  </Td>
                  <Td>
                    <StateBadge row={r} />
                  </Td>
                  <Td className="text-right">
                    <OrgInvoiceDownloadButton documentId={r.id} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <CardList>
            {result.rows.map((r) => (
              <Card
                key={r.id}
                title={r.number ?? r.name}
                actions={<OrgInvoiceDownloadButton documentId={r.id} />}
              >
                <CardRow label="Дата">{fmtDate(r.issuedAt)}</CardRow>
                <CardRow label="Заказ">{orderCell(r, orgId)}</CardRow>
                <CardRow label="Сумма">{money(r.amountGross)}</CardRow>
                <CardRow label="Оплачено">{money(r.paid)}</CardRow>
                <CardRow label="К оплате">{money(r.due)}</CardRow>
                <CardRow label="Состояние">
                  <StateBadge row={r} />
                </CardRow>
              </Card>
            ))}
          </CardList>
        </>
      )}
    </section>
  );
}
