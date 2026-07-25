'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Dialog, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { convertLeadToDealAction } from '@/server-actions/deals';
import type { LeadStatus } from '@prisma/client';

type Candidate = { id: string; name: string; email: string };

// Дельты поверх errorMessageRu (контекст действий над заявкой: центральный
// not_found говорит «Заказ не найден.», здесь сущность — заявка).
const ERROR_LABELS: Record<string, string> = {
  invalid_manager: 'Выбранный менеджер недоступен',
  not_found: 'Заявка не найдена.'
};

// Этап 6 PR-2 (ФТ-4.4): ошибки convertLeadToDealAction.
const CONVERT_ERRORS: Record<string, string> = {
  lifecycle_violation: 'Лид уже передан или отклонён.',
  not_found: 'Заявка не найдена.',
  forbidden: 'Нет доступа.'
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
  /** PR-2 (ФТ-4.4): кнопка «Создать сделку» — только при включённом deals_pipeline (пробрасывается страницей). */
  dealsEnabled?: boolean;
};

export function ManagerLeadActions({
  leadId,
  status,
  hasOrganization,
  promotedOrderId,
  candidates = [],
  dealsEnabled = false
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [dealConfirmOpen, setDealConfirmOpen] = useState(false);

  async function createDealFromLead() {
    setBusy(true);
    const fd = new FormData();
    fd.set('leadId', leadId);
    const res = await convertLeadToDealAction(fd);
    setBusy(false);
    setDealConfirmOpen(false);
    if (!res.ok) {
      toast.error(CONVERT_ERRORS[res.error] ?? 'Не удалось создать сделку.');
      return;
    }
    toast.success(
      <span>
        Сделка создана —{' '}
        <a href='/manager/deals' className='underline text-[#F97316]'>
          открыть доску сделок
        </a>
      </span>
    );
    router.refresh();
  }

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
      /* v8 ignore next -- ветка «finally с pending-исключением» недостижима: catch выше ловит всё */
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

  if (status === 'promoted_to_deal') {
    return (
      <Link href='/manager/deals' className='text-sm text-[#F97316] hover:underline'>
        Заявка передана в сделку — открыть доску сделок
      </Link>
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
        {dealsEnabled && (
          <Button variant='secondary' loading={busy} onClick={() => setDealConfirmOpen(true)}>
            Создать сделку
          </Button>
        )}
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
      {dealsEnabled && (
        <Dialog
          open={dealConfirmOpen}
          onClose={() => setDealConfirmOpen(false)}
          title='Создать сделку из лида?'
          size='sm'
          busy={busy}
        >
          <p className='text-sm text-gray-600 mb-3'>
            Лид получит статус «Передана в сделку», карточка появится на доске сделок.
          </p>
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' onClick={() => setDealConfirmOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button loading={busy} onClick={() => void createDealFromLead()}>
              Да, создать сделку
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
