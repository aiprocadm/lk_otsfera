'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import type { ImportBatchListItem } from '@/lib/services/import/rollback';
import { useRollbackFlow, RollbackDialogs } from './rollback-dialogs';

/**
 * «История импортов» (этап 9 ТЗ починки импорта, Т-39/Т-40): последние 20
 * батчей Excel-канала с кнопкой «Откатить». Сами диалоги подтверждения и
 * конфликтов — общие с историей обмена (`rollback-dialogs.tsx`), здесь
 * остаётся только список.
 */

const STATUS_RU: Record<string, string> = {
  committed: 'выполнен',
  rolled_back: 'откачен',
  rollback_partial: 'откачен частично',
};

/** Почему кнопка неактивна — иначе «нельзя» без причины (§15). */
const DISABLED_HINT: Partial<Record<ImportBatchListItem['rollback'], string>> = {
  expired:
    'Срок отката (30 дней) истёк — данные живут слишком долго, на них уже могло что-то завязаться',
  nothing_to_revert: 'Система не помнит, что записал этот импорт, — отменять нечего',
};

function countsLine(counts: ImportBatchListItem['counts']): string {
  const c = counts as {
    orgs?: { created?: number; updated?: number };
    orders?: { created?: number; updated?: number };
    payments?: { created?: number; updated?: number };
  } | null;
  if (!c) return '—';
  const part = (label: string, e?: { created?: number; updated?: number }) =>
    `${label} +${e?.created ?? 0}/~${e?.updated ?? 0}`;
  return `${part('орг.', c.orgs)} · ${part('заказы', c.orders)} · ${part('оплаты', c.payments)}`;
}

export function ImportHistory({ batches }: { batches: ImportBatchListItem[] }) {
  const router = useRouter();
  const flow = useRollbackFlow(() => router.refresh());

  if (batches.length === 0) {
    return <p className="text-sm text-gray-500">Импортов ещё не было.</p>;
  }

  // У-18: шесть колонок на телефоне не читаются — там карточки. Кнопка отката
  // одна и та же в обоих видах.
  const rollbackButton = (b: ImportBatchListItem) =>
    b.rollback === 'already_rolled_back' ? (
      <span className="text-xs text-gray-400">откачен</span>
    ) : (
      <Button
        variant="danger"
        size="sm"
        disabled={b.rollback !== 'available'}
        {...(DISABLED_HINT[b.rollback] ? { title: DISABLED_HINT[b.rollback] } : {})}
        onClick={() => void flow.open({ id: b.id, channel: 'excel' })}
        data-testid={`rollback-${b.id}`}
      >
        Откатить
      </Button>
    );

  return (
    <div>
      <CardList>
        {batches.map((b) => (
          <Card key={b.id} title={b.fileName} actions={rollbackButton(b)}>
            <CardRow label="Дата">{new Date(b.createdAt).toLocaleString('ru-RU')}</CardRow>
            <CardRow label="Кто">{b.importedByName ?? '—'}</CardRow>
            <CardRow label="Создано/обновлено">{countsLine(b.counts)}</CardRow>
            <CardRow label="Статус">{STATUS_RU[b.status] ?? b.status}</CardRow>
          </Card>
        ))}
      </CardList>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Дата
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Файл
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Кто
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Создано/обновлено
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Статус
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-gray-100" data-testid={`batch-${b.id}`}>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {new Date(b.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2 text-gray-700">{b.fileName}</td>
                <td className="px-3 py-2 text-gray-700">{b.importedByName ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {countsLine(b.counts)}
                </td>
                <td className="px-3 py-2 text-gray-700">{STATUS_RU[b.status] ?? b.status}</td>
                <td className="px-3 py-2">{rollbackButton(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RollbackDialogs flow={flow} />
    </div>
  );
}
