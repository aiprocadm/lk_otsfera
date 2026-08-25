import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { OrderDeal } from '@/lib/services/manager/orderDetail';

const STATUS: Record<
  'open' | 'won' | 'lost',
  { label: string; tone: 'info' | 'success' | 'danger' }
> = {
  open: { label: 'В работе', tone: 'info' },
  won: { label: 'Выиграна', tone: 'success' },
  lost: { label: 'Проиграна', tone: 'danger' },
};

type Props = {
  deal: NonNullable<OrderDeal>;
  /**
   * Адрес доски сделок того кабинета, откуда смотрят. `null` у админа —
   * зеркала сделок в `/admin/*` нет, а ссылка в несуществующий раздел это
   * мёртвая дверь (§4 CLAUDE.md).
   */
  dealsHref: string | null;
  /** Адрес карточки лида; `null` — если в кабинете лидов нет. */
  leadHrefBase: string | null;
};

/**
 * Панель «Сделка» на карточке заказа — обратная половина связи заказ ↔ сделка
 * (спека `2026-08-19-order-deal-link-design.md`). Отвечает на вопрос «откуда
 * взялся этот заказ»: показывает переговоры, из которых он вырос, и цепочку
 * происхождения (лид, исходное обращение).
 *
 * Строго презентационный и domain-agnostic — поэтому общий на кабинеты
 * сотрудников, а не sibling-копии (§4). Ролевых решений внутри нет: что
 * показывать и куда вести ссылки, решает страница.
 *
 * Клиентским кабинетам (заказчик, партнёр) панель НЕ монтируется: сумма
 * переговоров, ответственный и стадия — внутренняя кухня продаж.
 */
export function OrderDealPanel({ deal, dealsHref, leadHrefBase }: Props) {
  const status = STATUS[deal.status];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#111111]">Сделка</h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <p className="text-xs text-gray-500">Переговоры, из которых вырос этот заказ.</p>

      <p className="text-sm font-medium text-[#111111]">{deal.title}</p>

      <dl className="space-y-1.5 text-sm">
        {deal.stageName && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Стадия</dt>
            <dd className="text-[#111111] text-right">{deal.stageName}</dd>
          </div>
        )}
        {deal.amount && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Сумма</dt>
            <dd className="text-[#111111] text-right">{fmtMoney(deal.amount)}</dd>
          </div>
        )}
        {deal.managerName && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Ответственный</dt>
            <dd className="text-[#111111] text-right">{deal.managerName}</dd>
          </div>
        )}
        {deal.wonAt && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">Выиграна</dt>
            <dd className="text-[#111111] text-right">{fmtDate(deal.wonAt)}</dd>
          </div>
        )}
      </dl>

      {deal.lead && (
        <div className="border-t border-gray-200 pt-3 space-y-1.5 text-sm">
          <p className="text-xs text-gray-500">Откуда пришла сделка</p>
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Лид</dt>
              <dd className="text-right">
                {leadHrefBase ? (
                  <Link
                    href={`${leadHrefBase}/${deal.lead.id}`}
                    className="text-[#EA580C] hover:underline"
                  >
                    {deal.lead.clientCompanyName}
                  </Link>
                ) : (
                  <span className="text-[#111111]">{deal.lead.clientCompanyName}</span>
                )}
              </dd>
            </div>
            {deal.lead.sourceRequest && (
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Обращение</dt>
                <dd className="text-[#111111] text-right">{deal.lead.sourceRequest.subject}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {dealsHref && (
        <Link href={dealsHref} className="inline-block text-sm text-[#EA580C] hover:underline">
          Все сделки →
        </Link>
      )}
    </div>
  );
}
