'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { reissuePanelAction } from '@/server-actions/documents/reissue';
import type { ReissuePanel } from '@/lib/services/documents/generationPanel';
import { IssueDocumentDialog, type IssueDocType } from '@/components/manager/issue-document-dialog';

/**
 * «Перевыпустить» — новая версия документа с ТЕМ ЖЕ номером (`У-151`).
 *
 * До этапа 6 перевыпуска не было вовсе: повторная генерация выдавала новый
 * номер, а прежний сгорал (`Д-3`). Теперь номер сохраняется, версия растёт, а
 * прежняя версия помечается заменённой и уходит из списков.
 *
 * Данные формы грузятся по клику: на карточке документа они нужны редко, а
 * тянуть каталог и реквизиты на каждый просмотр — платить за то, чего человек
 * не открывал.
 */
/** Дельты поверх словаря: общие строки писались для форм загрузки файлов. */
const REISSUE_ERROR_RU: Record<string, string> = {
  forbidden: 'Нет прав перевыпускать документы.',
  not_found: 'Документ не найден или недоступен. Обновите страницу.',
};

export function ReissueDocumentButton({ documentId }: { documentId: string }) {
  const [panel, setPanel] = useState<ReissuePanel | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function openForm() {
    setBusy(true);
    const fd = new FormData();
    fd.set('documentId', documentId);
    try {
      const res = await reissuePanelAction(fd);
      if (!res.ok) {
        toast.error(REISSUE_ERROR_RU[res.error] ?? errorMessageRu(res.error));
        return;
      }
      setPanel(res.panel);
      setOpen(true);
    } catch {
      toast.error(errorMessageRu('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => void openForm()}>
        {busy ? 'Готовлю форму…' : 'Перевыпустить'}
      </Button>
      {panel && (
        <IssueDocumentDialog
          open={open}
          onClose={() => setOpen(false)}
          target={panel.target}
          counterpartyName={panel.counterpartyName}
          orderLines={panel.lines}
          missingByType={panel.missingByType}
          baseDocuments={panel.baseDocuments}
          hasInvoice={panel.hasInvoice}
          hasContract={panel.hasContract}
          catalog={panel.catalog}
          reissueOfDocumentId={documentId}
          lockedDocType={panel.docType as IssueDocType}
        />
      )}
    </>
  );
}
