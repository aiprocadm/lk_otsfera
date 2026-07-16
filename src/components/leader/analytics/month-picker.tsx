import React from 'react';
import { Button, Input } from '@/components/ui';

/**
 * M3 — выбор периода (GET-form, без клиентского JS). Сабмит навигирует на
 * `?month=YYYY-MM`; страница парсит параметр и падает на текущий месяц при
 * отсутствии/некорректности (см. src/app/leader/analytics/page.tsx).
 */
export function MonthPicker({ month }: { month: string }) {
  return (
    <form method='get' className='flex flex-wrap items-end gap-3'>
      <label className='text-xs text-gray-600 flex flex-col gap-1'>
        Период
        <Input type='month' name='month' defaultValue={month} aria-label='Период' className='max-w-[180px]' />
      </label>
      <Button type='submit'>Показать</Button>
    </form>
  );
}
