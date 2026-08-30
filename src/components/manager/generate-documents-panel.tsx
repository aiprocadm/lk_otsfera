'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { requestRequisitesAction } from '@/server-actions/documents/generate';
import type { MissingRequisite } from '@/lib/documents/requisites-check';
import type { IssueBaseDocument } from '@/lib/services/documents/generationPanel';
import { IssueDocumentDialog, type IssueDocType, type IssueLine } from './issue-document-dialog';

/**
 * Панель «Документы по заказу» на карточке заказа.
 *
 * Этап 6 (`У-147`): вместо четырёх кнопок «в один клик» — одна главная кнопка,
 * которая открывает форму выпуска. Прежний вид не давал сотруднику ни
 * посмотреть, что уйдёт клиенту, ни поправить строку или дату.
 *
 * Панель презентационная: недостающие реквизиты **по типу документа**
 * (`У-156`) считает страница через сервис, а решение о выпуске — сервер.
 */
export function GenerateDocumentsPanel({
  orderId,
  counterpartyName,
  orderLines,
  missingByType,
  baseDocuments,
  hasInvoice,
  hasContract,
}: {
  orderId: string;
  counterpartyName: string;
  orderLines: IssueLine[];
  missingByType: Record<IssueDocType, MissingRequisite[]>;
  baseDocuments: IssueBaseDocument[];
  hasInvoice: boolean;
  hasContract: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `У-157`: когда реквизиты запрашивали в прошлый раз — показываем рядом
  // с кнопкой, чтобы повтор не выглядел молчаливым отказом.
  const [requestedAt, setRequestedAt] = useState<string | null>(null);

  // Реквизиты счёта — самый частый случай; их нехватку показываем сразу, не
  // заставляя открывать форму, чтобы узнать, что выпустить нечего.
  const invoiceMissing = missingByType.invoice ?? [];
  const orgMissing = invoiceMissing.filter((m) => m.side === 'organization');
  const companyMissing = invoiceMissing.filter((m) => m.side === 'company');

  async function requestFromClient() {
    const fd = new FormData();
    fd.set('orderId', orderId);
    setBusy(true);
    const res = await requestRequisitesAction(fd);
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'requested_recently') {
        // `У-157`: молчаливый отказ выглядел бы как поломка кнопки — говорим,
        // когда просили в прошлый раз.
        const when = new Date(res.requestedAt).toLocaleString('ru-RU');
        setRequestedAt(when);
        toast.error(`Реквизиты уже запрашивали ${when}. Повторить можно через сутки.`);
        return;
      }
      toast.error('Не удалось отправить запрос.');
      return;
    }
    setRequestedAt(new Date().toLocaleString('ru-RU'));
    toast.success('Запрос реквизитов отправлен организации.');
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-[#111111]">Документы по заказу</h2>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        Счёт, акт, договор и доп. соглашение — с предпросмотром до выпуска.
      </p>
      <Button size="sm" onClick={() => setOpen(true)}>
        Выпустить документ
      </Button>

      {invoiceMissing.length > 0 && (
        <div className="mt-3" data-testid="missing-requisites">
          <p className="text-sm text-gray-700">Для счёта не хватает реквизитов:</p>
          <ul className="text-sm text-red-600 list-disc pl-5 mt-1 space-y-0.5">
            {invoiceMissing.map((m) => (
              <li key={`${m.side}:${m.label}`}>{m.label}</li>
            ))}
          </ul>
          {orgMissing.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={busy}
              onClick={() => void requestFromClient()}
            >
              {busy ? 'Отправляю…' : 'Запросить у клиента'}
            </Button>
          )}
          {requestedAt && <p className="text-xs text-gray-500 mt-1">Запрошено {requestedAt}.</p>}
          {companyMissing.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Реквизиты исполнителя заполняются в настройках: «Реквизиты исполнителя».
            </p>
          )}
        </div>
      )}

      <IssueDocumentDialog
        open={open}
        onClose={() => setOpen(false)}
        target={{ kind: 'order', orderId }}
        counterpartyName={counterpartyName}
        orderLines={orderLines}
        missingByType={missingByType}
        baseDocuments={baseDocuments}
        hasInvoice={hasInvoice}
        hasContract={hasContract}
      />
    </div>
  );
}
