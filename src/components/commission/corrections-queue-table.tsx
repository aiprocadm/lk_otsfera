'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, EmptyState, Field, Textarea, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { fmtMoney, fmtDate } from '@/lib/format';
import { resolveCorrectionAction } from '@/server-actions/commission/corrections';

export type CorrectionRow = {
  id: string;
  partnerName: string;
  amount: string;
  commissionAmount: string;
  rate: string;
  originalPeriodFrom: string | Date;
  originalPeriodTo: string | Date;
};

type Action = 'apply' | 'waive';

export function CorrectionsQueueTable({ rows }: { rows: CorrectionRow[] }) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ row: CorrectionRow; action: Action } | null>(null);
  const visible = rows.filter((r) => !resolved.has(r.id));

  if (visible.length === 0) {
    return <EmptyState message='Очередь пуста — нет корректировок, требующих решения.' />;
  }

  return (
    <TableShell overflow='x-auto'>
      <THead>
        <Th>Партнёр</Th>
        <Th>Период возврата</Th>
        <Th className='text-right'>Сумма возврата</Th>
        <Th className='text-right'>Удержание</Th>
        <Th className='text-right'>Действия</Th>
      </THead>
      <tbody>
        {visible.map((r) => (
          <Tr key={r.id}>
            <Td className='text-gray-700'>{r.partnerName}</Td>
            <Td className='text-gray-700'>
              {fmtDate(r.originalPeriodFrom)} — {fmtDate(r.originalPeriodTo)}
            </Td>
            <Td className='text-right text-gray-700'>{fmtMoney(r.amount)}</Td>
            <Td className='text-right text-gray-700'>{fmtMoney(r.commissionAmount)}</Td>
            <Td className='text-right'>
              <div className='flex justify-end gap-2'>
                <Button size='sm' onClick={() => setActive({ row: r, action: 'apply' })}>
                  Применить
                </Button>
                <Button size='sm' variant='secondary' onClick={() => setActive({ row: r, action: 'waive' })}>
                  Списать
                </Button>
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>

      {active && (
        <ResolveDialog
          row={active.row}
          action={active.action}
          onClose={() => setActive(null)}
          onResolved={(id) => {
            setResolved((s) => new Set(s).add(id));
            setActive(null);
          }}
        />
      )}
    </TableShell>
  );
}

function ResolveDialog({
  row,
  action,
  onClose,
  onResolved
}: {
  row: CorrectionRow;
  action: Action;
  onClose: () => void;
  onResolved: (id: string) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWaive = action === 'waive';
  const reasonMissing = isWaive && !reason.trim();

  async function submit() {
    // defense-in-depth: the submit Button is `disabled={reasonMissing}`, so this
    // branch is unreachable via UI click (native `disabled` blocks the DOM click
    // event); kept in case submit() is ever wired to a non-click trigger (e.g. Enter key).
    /* v8 ignore next */
    if (reasonMissing) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    fd.append('correctionId', row.id);
    fd.append('action', action);
    if (isWaive) fd.append('reason', reason.trim());
    try {
      const res = await resolveCorrectionAction(fd);
      if (res.ok) {
        toast.success(isWaive ? 'Корректировка списана' : 'Корректировка применена');
        onResolved(row.id);
        router.refresh();
        return;
      }
      setError(errorMessageRu(res.error, `Ошибка: ${res.error}`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={isWaive ? 'Списать корректировку' : 'Применить корректировку'}
      busy={submitting}
      error={error}
    >
      <div className='space-y-4'>
        <p className='text-sm text-gray-600'>
          {row.partnerName} · возврат {fmtMoney(row.amount)} · удержание {fmtMoney(row.commissionAmount)}
        </p>
        <p className='text-xs text-gray-500'>
          {isWaive
            ? 'Корректировка будет списана без удержания. Укажите причину.'
            : 'Удержание будет добавлено в следующую ведомость партнёра.'}
        </p>

        {isWaive && (
          <Field htmlFor='waive-reason' label='Причина списания'>
            <Textarea
              id='waive-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Почему корректировка списывается…'
              invalid={reasonMissing}
              rows={3}
            />
          </Field>
        )}

        <div className='flex justify-end gap-2 pt-2'>
          <Button variant='secondary' onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={submit} loading={submitting} disabled={reasonMissing}>
            {isWaive ? 'Списать' : 'Применить'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
