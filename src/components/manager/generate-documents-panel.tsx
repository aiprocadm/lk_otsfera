'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { generateOrderDocumentAction, requestRequisitesAction } from '@/server-actions/documents/generate';
import type { MissingRequisite } from '@/lib/documents/requisites-check';

/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — панель «Сформировать документы» на деталке
 * заказа: кнопки Счёт/Акт; при неполных реквизитах кнопки неактивны, рядом
 * список недостающего и «Запросить у клиента». `missing` считает страница
 * (сервисный валидатор) — панель презентационно-интерактивная.
 */

const GENERATE_ERRORS: Record<string, string> = {
  invoice_required: 'Сначала сформируйте счёт — акт наследует его номер.',
  contract_required: 'Сначала сформируйте договор — доп. соглашение наследует его номер.',
  missing_requisites: 'Не хватает реквизитов — заполните и попробуйте снова.',
  no_organization: 'К заказу не привязана организация.',
  storage: 'Хранилище файлов недоступно. Попробуйте позже.',
  not_found: 'Заказ не найден или недоступен.',
  forbidden: 'Нет доступа.'
};

type DocKind = 'invoice' | 'act' | 'contract' | 'extra_agreement';

const DOC_LABEL: Record<DocKind, string> = {
  invoice: 'Счёт',
  act: 'Акт',
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение'
};

export function GenerateDocumentsPanel({
  orderId,
  missing,
  hasInvoice,
  hasContract = false
}: {
  orderId: string;
  missing: MissingRequisite[];
  hasInvoice: boolean;
  /** Этап 8 PR-3: доп. соглашение наследует номер договора. */
  hasContract?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const complete = missing.length === 0;

  async function generate(docType: DocKind) {
    const fd = new FormData();
    fd.set('orderId', orderId);
    fd.set('docType', docType);
    setBusy(docType);
    const res = await generateOrderDocumentAction(fd);
    setBusy(null);
    if (!res.ok) {
      toast.error(GENERATE_ERRORS[res.error] ?? 'Не удалось сформировать документ.');
      return;
    }
    toast.success(`${DOC_LABEL[docType]} № ${res.number} сформирован.`);
    startTransition(() => router.refresh());
  }

  async function requestFromClient() {
    const fd = new FormData();
    fd.set('orderId', orderId);
    setBusy('request');
    const res = await requestRequisitesAction(fd);
    setBusy(null);
    if (!res.ok) {
      toast.error('Не удалось отправить запрос.');
      return;
    }
    toast.success('Запрос реквизитов отправлен организации.');
  }

  return (
    <div className='rounded-xl border border-gray-200 p-4'>
      <h2 className='text-sm font-semibold text-[#111111] mb-2'>Сформировать документы</h2>
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' disabled={!complete || busy !== null} onClick={() => void generate('invoice')}>
          {busy === 'invoice' ? 'Формирую…' : DOC_LABEL.invoice}
        </Button>
        <Button
          size='sm'
          disabled={!complete || !hasInvoice || busy !== null}
          onClick={() => void generate('act')}
          title={hasInvoice ? undefined : 'Сначала сформируйте счёт'}
        >
          {busy === 'act' ? 'Формирую…' : DOC_LABEL.act}
        </Button>
        <Button size='sm' disabled={!complete || busy !== null} onClick={() => void generate('contract')}>
          {busy === 'contract' ? 'Формирую…' : DOC_LABEL.contract}
        </Button>
        <Button
          size='sm'
          disabled={!complete || !hasContract || busy !== null}
          onClick={() => void generate('extra_agreement')}
          title={hasContract ? undefined : 'Сначала сформируйте договор'}
        >
          {busy === 'extra_agreement' ? 'Формирую…' : DOC_LABEL.extra_agreement}
        </Button>
      </div>
      {complete && (!hasInvoice || !hasContract) && (
        <p className='text-xs text-gray-500 mt-2'>
          {!hasInvoice && 'Акт станет доступен после формирования счёта (наследует его номер). '}
          {!hasContract && 'Доп. соглашение — после формирования договора.'}
        </p>
      )}
      {!complete && (
        <div className='mt-3' data-testid='missing-requisites'>
          <p className='text-sm text-gray-700'>Не хватает реквизитов:</p>
          <ul className='text-sm text-red-600 list-disc pl-5 mt-1 space-y-0.5'>
            {missing.map((m) => (
              <li key={`${m.side}:${m.label}`}>{m.label}</li>
            ))}
          </ul>
          {missing.some((m) => m.side === 'organization') && (
            <Button size='sm' variant='secondary' className='mt-2' disabled={busy !== null} onClick={() => void requestFromClient()}>
              {busy === 'request' ? 'Отправляю…' : 'Запросить у клиента'}
            </Button>
          )}
          {missing.some((m) => m.side === 'company') && (
            <p className='text-xs text-gray-500 mt-2'>Реквизиты исполнителя заполняет администратор в настройках админки.</p>
          )}
        </div>
      )}
    </div>
  );
}
