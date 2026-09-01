import React from 'react';
import Link from 'next/link';
import { DocumentsList } from '@/components/partner/documents-list';
import { ManagerOrderLessUploadForm } from '@/components/manager/manager-order-less-upload-form';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';
import type { ListDocumentsResult, ManagerOrderLessRow } from '@/lib/services/manager/documents';
import type { ManagerCounterparties } from '@/lib/services/manager/counterparties';
import { sectionLabel } from '@/lib/navigation/sectionLabels';

import { PageHeader } from '@/components/ui/page-header';
/**
 * Экран «Документы» сотрудников ЦО — один компонент на кабинет менеджера и
 * кабинет руководителя (`У-110`, решение `Р-23`).
 *
 * У руководителя этого раздела не было вовсе: чтобы посмотреть документы, он
 * уходил в кабинет менеджера — и видел там **свой** срез, а не срез компании.
 * Теперь экран общий, а разница ровно одна и она про данные: руководитель
 * смотрит по всей компании, рядовой менеджер — по своему охвату.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку — со своим охватом (`teamModeOverride`)
 * — делает страница своей роли, скоуп держит сервис.
 *
 * Все адреса собираются из `cabinet`, поэтому переезд одной ссылки не может
 * «расщепить» кабинеты.
 */
export type StaffDocumentsSearchParams = {
  search?: string;
  type?: string;
  orderId?: string;
  cursor?: string;
  tab?: string;
};

/**
 * Данные экрана готовит страница-потребитель: вкладку выбирает `sp.tab`,
 * страница грузит ровно её срез и передаёт сюда готовые строки сервисов.
 */
type StaffDocumentsData =
  | { tab: 'general'; rows: ManagerOrderLessRow[]; counterparties: ManagerCounterparties }
  | { tab: 'orders'; rows: ListDocumentsResult['rows']; nextCursor: string | null };

/**
 * Значения — литералы `enum DocumentType` из prisma/schema.prisma; подписи —
 * русские. Появился новый тип в схеме — добавь строку сюда.
 */
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'waybill', label: 'Накладная' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'report', label: 'Отчёт' },
  { value: 'commission_statement', label: 'Расчёт комиссии' },
  { value: 'commercial_proposal', label: 'Коммерческое предложение' },
  { value: 'other', label: 'Прочее' },
];

function TabChips({
  activeTab,
  ordersHref,
  generalHref,
}: {
  activeTab: 'orders' | 'general';
  ordersHref: string;
  generalHref: string;
}) {
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
      active ? 'bg-[#F97316] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`;
  return (
    <div className="flex gap-2">
      <Link href={ordersHref} className={chip(activeTab === 'orders')}>
        По заказам
      </Link>
      <Link href={generalHref} className={chip(activeTab === 'general')}>
        Общие документы
      </Link>
    </div>
  );
}

function Header() {
  return (
    <>
      <PageHeader
        title={sectionLabel('documents')}
        subtitle="Договоры, счета и акты по вашим клиентам"
      />
    </>
  );
}

export function StaffDocuments({
  cabinet,
  sp,
  data,
}: {
  cabinet: 'manager' | 'leader';
  /** Уже развёрнутые query-параметры — из них собираются ссылки фильтров. */
  sp: StaffDocumentsSearchParams;
  data: StaffDocumentsData;
}) {
  const base = `/${cabinet}/documents`;

  if (data.tab === 'general') {
    const documentRows: OrgDocumentRow[] = data.rows.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      direction: d.direction,
      signedAt: d.signedAt,
      createdAt: d.createdAt,
      size: d.size,
      orderId: null,
      orderNumber: null,
      orderTitle: null,
      number: d.number,
      version: d.version,
    }));

    return (
      <div className="space-y-4">
        <Header />
        <TabChips activeTab="general" ordersHref={base} generalHref={`${base}?tab=general`} />
        <ManagerOrderLessUploadForm
          organizations={data.counterparties.organizations}
          partners={data.counterparties.partners}
        />
        <DocumentsList
          rows={documentRows}
          downloadEndpointBase="/api/manager/documents"
          cardHrefBase={base}
        />
      </div>
    );
  }

  // Сервис отдаёт сырые строки `Document` с включённым заказом, а общий список
  // (тот же, что у партнёра и заказчика) ждёт `OrgDocumentRow` — складываем
  // контекст заказа здесь.
  const documentRows: OrgDocumentRow[] = data.rows.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: d.orderId,
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null,
    number: d.number,
    version: d.version,
  }));

  // Фильтры переносим в ссылку «Дальше» — иначе постраничный переход молча
  // сбрасывает то, что человек только что выбрал.
  const withFilters = (extra?: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.search) p.set('search', sp.search);
    if (sp.type) p.set('type', sp.type);
    if (sp.orderId) p.set('orderId', sp.orderId);
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="space-y-4">
      <Header />

      <TabChips activeTab="orders" ordersHref={withFilters()} generalHref={`${base}?tab=general`} />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Поиск по названию…"
          className="border border-gray-200 rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
        <select
          name="type"
          defaultValue={sp.type ?? ''}
          className="border border-gray-200 rounded px-2 py-1 text-sm"
        >
          <option value="">Все типы</option>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {sp.orderId && <input type="hidden" name="orderId" value={sp.orderId} />}
        <button
          type="submit"
          className="px-3 py-1 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C]"
        >
          Найти
        </button>
      </form>

      <DocumentsList
        rows={documentRows}
        downloadEndpointBase="/api/manager/documents"
        cardHrefBase={base}
      />

      {data.nextCursor && (
        <div>
          <Link
            href={withFilters({ cursor: data.nextCursor })}
            className="inline-block text-sm text-[#F97316] hover:underline"
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}
