/**
 * Этап 11 PR-2 (Модуль 15, ФТ-15.6) — хлебные крошки цепочки
 * «заявка → лид → сделка → заказ» во внутреннем контуре.
 *
 * Чистые построители: на вход — уже загруженные сущности, на выход — список
 * крошек. Без БД и без Next — юнит-тестируемы и не тянут слой выше в сервисы.
 *
 * Правило: **последняя крошка — текущая страница и ссылки не имеет**
 * (`href: null`). У обращений и сделок нет отдельных деталок, поэтому их
 * крошки ведут на список/доску — это честнее, чем ссылка в никуда.
 */

export type Crumb = { label: string; href: string | null };

/** Короткая подпись сущности: номер/название с ограничением длины. */
function short(value: string | null | undefined, fallback: string): string {
  const text = (value ?? '').trim();
  if (!text) return fallback;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export type LeadCrumbInput = {
  title: string | null;
  /** Обращение-источник (Lead.sourceRequest), если лид вырос из него. */
  sourceRequest: { id: string; subject: string | null } | null;
};

/** Крошки деталки лида. */
export function buildLeadBreadcrumbs(lead: LeadCrumbInput): Crumb[] {
  const crumbs: Crumb[] = [];
  if (lead.sourceRequest) {
    crumbs.push({ label: 'Обращения', href: '/manager/requests' });
    crumbs.push({
      label: short(lead.sourceRequest.subject, 'Обращение'),
      href: '/manager/requests',
    });
  } else {
    crumbs.push({ label: 'Лиды', href: '/manager/leads' });
  }
  crumbs.push({ label: short(lead.title, 'Лид'), href: null });
  return crumbs;
}

export type OrderCrumbInput = {
  orderNumber: string | null;
  title: string | null;
  /** Сделка, из которой вырос заказ (Deal.orderId), с её лидом и обращением. */
  deal: {
    title: string | null;
    lead: {
      id: string;
      title: string | null;
      sourceRequest: { id: string; subject: string | null } | null;
    } | null;
  } | null;
};

/** Крошки деталки заказа: разворачивает всю цепочку, что есть в данных. */
export function buildOrderBreadcrumbs(order: OrderCrumbInput): Crumb[] {
  const crumbs: Crumb[] = [];
  const lead = order.deal?.lead ?? null;

  if (lead?.sourceRequest) {
    crumbs.push({ label: 'Обращения', href: '/manager/requests' });
    crumbs.push({
      label: short(lead.sourceRequest.subject, 'Обращение'),
      href: '/manager/requests',
    });
  }
  if (lead) {
    crumbs.push({ label: short(lead.title, 'Лид'), href: `/manager/leads/${lead.id}` });
  }
  if (order.deal) {
    crumbs.push({ label: 'Сделки', href: '/manager/deals' });
    crumbs.push({ label: short(order.deal.title, 'Сделка'), href: '/manager/deals' });
  }
  if (crumbs.length === 0) {
    crumbs.push({ label: 'Заказы', href: '/manager/orders' });
  }

  const label = order.orderNumber ? `Заказ №${order.orderNumber}` : short(order.title, 'Заказ');
  crumbs.push({ label, href: null });
  return crumbs;
}
