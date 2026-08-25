import React from 'react';
import type { OrgCard } from '@/lib/services/partner/orgCard';

import { PageHeader } from '@/components/ui/page-header';
function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function OrgCardHeader({ card }: { card: OrgCard }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      {/* `У-120`: карточка сущности — подзаголовком идут её реквизиты,
          сводка справа — тот же проп `action`, что у кнопки на списках. */}
      <PageHeader
        title={card.name}
        subtitle={
          <>
            ИНН {card.inn ?? '—'}
            {card.kpp ? ` · КПП ${card.kpp}` : ''}
            {card.legalName && (
              <span className="block text-xs text-gray-400">{card.legalName}</span>
            )}
          </>
        }
        action={
          <div className="grid grid-cols-2 gap-3 md:gap-4 md:min-w-[280px]">
            <Tile label="Сделок" value={String(card.kpi.ordersCount)} />
            <Tile label="Долг" value={fmtMoney(card.kpi.debt)} accent={Number(card.kpi.debt) > 0} />
          </div>
        }
      />
      {card.partnerCommissionRate !== null && (
        <div className="mt-3 px-3 py-2 bg-[#FFF7ED] border border-orange-100 rounded-lg text-xs text-orange-800">
          Индивидуальная ставка комиссии:{' '}
          <strong>{(Number(card.partnerCommissionRate) * 100).toFixed(2)}%</strong>
          {card.partnerCommissionRateNote && (
            <span className="ml-1 text-orange-600">· {card.partnerCommissionRateNote}</span>
          )}
          {/* У-3 / Р-6: партнёр видит ставку только на чтение. */}
          <div className="mt-1 text-[11px] text-orange-700">
            Назначает учебный центр — в кабинете партнёра ставка не редактируется.
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 ${accent ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-red-700' : 'text-[#111111]'}`}>
        {value}
      </div>
    </div>
  );
}
