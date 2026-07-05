import React from 'react';
import type { DealDetail } from '@/lib/services/partner/dealDetail';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(s)) + ' ₽';
}

export function DealAmounts({ deal }: { deal: DealDetail }) {
  const paidPct = Number(deal.totalAmount) > 0
    ? Math.min(100, Math.round((Number(deal.paidAmount) / Number(deal.totalAmount)) * 100))
    : 0;

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <h2 className='text-sm font-semibold text-[#111111]'>Финансы</h2>

      <div className='grid grid-cols-3 gap-3'>
        <Tile label='Сумма' value={fmtMoney(deal.totalAmount)} />
        <Tile label='Оплачено' value={fmtMoney(deal.paidAmount)} tone='success' />
        <Tile
          label='Долг'
          value={fmtMoney(deal.debt)}
          tone={Number(deal.debt) > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {Number(deal.totalAmount) > 0 && (
        <div>
          <div className='flex justify-between text-xs text-gray-500 mb-1'>
            <span>Оплачено</span>
            <span>{paidPct}%</span>
          </div>
          <div className='h-2 bg-gray-100 rounded-full overflow-hidden'>
            <div
              className='h-full bg-green-500 rounded-full transition-all'
              style={{ width: `${paidPct}%` }}
              role='progressbar'
              aria-valuenow={paidPct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      <div className='text-xs text-gray-500'>
        {deal.vatIncluded ? 'НДС включён' : 'Без НДС'}
        {deal.vatRate && (
          <span> · ставка {(Number(deal.vatRate) * 100).toFixed(0)}%</span>
        )}
      </div>
    </div>
  );
}

function Tile({
  label, value, tone
}: { label: string; value: string; tone?: 'success' | 'danger' | 'neutral' }) {
  const colors =
    tone === 'success'
      ? 'bg-green-50 border-green-100 text-green-800'
      : tone === 'danger'
      ? 'bg-red-50 border-red-100 text-red-800'
      : 'bg-gray-50 border-gray-100 text-[#111111]';
  return (
    <div className={`rounded-lg border p-3 ${colors}`}>
      <div className='text-[10px] uppercase tracking-wider text-gray-500'>{label}</div>
      <div className='text-base font-bold mt-0.5'>{value}</div>
    </div>
  );
}
