'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type { LeadStatus } from '@prisma/client';

type Candidate = { id: string; name: string; email: string };

// Дельты поверх errorMessageRu (контекст передачи заявки конкретному менеджеру).
const ERROR_LABELS: Record<string, string> = {
  invalid_manager: 'Выбранный менеджер недоступен'
};

function patchErrorText(code: string | undefined, status: number): string {
  if (!code) return `Не удалось выполнить действие: ${status}`;
  return ERROR_LABELS[code] ?? errorMessageRu(code, `Не удалось выполнить действие: ${code}`);
}

type Props = {
  leadId: string;
  status: LeadStatus;
  hasOrganization: boolean;
  promotedOrderId: string | null;
  candidates?: Candidate[];
};

export function ManagerLeadActions({ leadId, status, hasOrganization, promotedOrderId, candidates = [] }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assignTo, setAssignTo] = useState('');

  async function run(body: Record<string, unknown>, successMsg: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/manager/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(patchErrorText(e.error, res.status));
        return false;
      }
      toast.success(successMsg);
      router.refresh();
      return true;
    } catch {
      toast.error('Сетевая ошибка');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (status === 'promoted_to_order') {
    return promotedOrderId ? (
      <Link
        href={`/manager/orders/${promotedOrderId}`}
        className='inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-[#F97316] text-white hover:bg-[#EA580C]'
      >
        Открыть заказ
      </Link>
    ) : (
      <span className='text-sm text-gray-500'>Заявка преобразована в заказ</span>
    );
  }

  if (status === 'rejected') {
    return <span className='text-sm text-gray-500'>Заявка отклонена</span>;
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-2'>
        <Button variant='secondary' loading={busy} onClick={() => run({ action: 'assign' }, 'Заявка взята в работу')}>
          Взять в работу
        </Button>
        {status === 'in_review' && (
          <>
            <Button variant='secondary' loading={busy} onClick={() => run({ action: 'setStatus', status: 'qualified' }, 'Заявка квалифицирована')}>
              Квалифицировать
            </Button>
            <Button variant='ghost' loading={busy} onClick={() => run({ action: 'setStatus', status: 'new' }, 'Заявка возвращена в новые')}>
              Вернуть в новые
            </Button>
          </>
        )}
        {status === 'qualified' && (
          <Button variant='ghost' loading={busy} onClick={() => run({ action: 'setStatus', status: 'in_review' }, 'Возвращено на рассмотрение')}>
            Вернуть на рассмотрение
          </Button>
        )}
        <Button
          variant='primary'
          loading={busy}
          disabled={!hasOrganization}
          title={hasOrganization ? undefined : 'Сначала привяжите организацию к заявке'}
          onClick={() => run({ action: 'promote' }, 'Создан заказ из заявки')}
        >
          Преобразовать в заказ
        </Button>
        <Button
          variant='danger'
          loading={busy}
          onClick={() => {
            const reason = window.prompt('Причина отклонения заявки:');
            if (reason !== null) run({ action: 'reject', reason }, 'Заявка отклонена');
          }}
        >
          Отклонить
        </Button>
      </div>
      {candidates.length > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            aria-label='Менеджер для передачи заявки'
            className='w-auto min-w-56'
            value={assignTo}
            disabled={busy}
            onChange={(e) => setAssignTo(e.target.value)}
          >
            <option value=''>Выберите менеджера…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.name} (${c.email})`}
              </option>
            ))}
          </Select>
          <Button
            variant='secondary'
            loading={busy}
            disabled={!assignTo}
            onClick={async () => {
              if (await run({ action: 'assign', assignToUserId: assignTo }, 'Заявка передана менеджеру')) setAssignTo('');
            }}
          >
            Передать
          </Button>
        </div>
      )}
    </div>
  );
}
