'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { leadIssuePanelAction, orgIssuePanelAction } from '@/server-actions/documents/generate';
import type { OrgDocumentIssuePanel } from '@/lib/services/documents/generationPanel';
import { IssueDocumentDialog, type IssueLine } from '@/components/manager/issue-document-dialog';

/**
 * Выпуск счёта, договора или ДС **без заказа** (`У-145`).
 *
 * Точек входа две — вкладка «Документы» карточки организации и карточка
 * сделки, — поэтому здесь два экспорта на один загрузчик: кнопка (карточка
 * организации) и сам диалог (сделка, где открывающая кнопка живёт в диалоге
 * сделки, а вложенные модалки мы не строим).
 *
 * Данные формы (реквизиты, каталог, договоры-основания) подгружаются **по
 * открытию**, а не пропсами страницы: на доске сделок карточек десятки, и
 * готовить каталог для каждой при отрисовке значило бы платить за то, чего
 * человек не открывал.
 */

type Prefill = {
  /** Строки, которыми открывается форма: у сделки — её название и сумма. */
  prefillLines?: IssueLine[];
  /** Предмет договора по умолчанию: у сделки — её название. */
  defaultSubject?: string;
};

export function IssueOrderLessDocumentDialog({
  organizationId,
  onClose,
  prefillLines = [],
  defaultSubject = '',
}: { organizationId: string; onClose: () => void } & Prefill) {
  const [panel, setPanel] = useState<OrgDocumentIssuePanel | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const fd = new FormData();
      fd.set('organizationId', organizationId);
      const res = await orgIssuePanelAction(fd);
      if (!alive) return;
      if (!res.ok) {
        // Молчаливо неработающая кнопка — дефект приёмки (§15): говорим, что
        // именно мешает выпустить документ, и закрываем форму.
        toast.error(errorMessageRu(res.error));
        onClose();
        return;
      }
      setPanel(res.panel);
    })();
    return () => {
      alive = false;
    };
    // Загрузка одна на открытие: организация за время жизни диалога не меняется.
  }, [organizationId, onClose]);

  if (!panel) return null;
  // Предзаполнение приходит от сделки, где ставки НДС нет вовсе. Оставить её
  // пустой значило бы напечатать плательщику НДС документ «НДС не облагается»
  // — поле выглядит просто незаполненным, и ошибку никто не заметит.
  const lines = prefillLines.map((line) => ({
    ...line,
    vatRate: line.vatRate ?? panel.defaultVatRate,
  }));
  return (
    <IssueDocumentDialog
      open
      onClose={onClose}
      target={{ kind: 'organization', organizationId }}
      counterpartyName={panel.counterpartyName}
      orderLines={lines}
      missingByType={panel.missingByType}
      baseDocuments={panel.baseDocuments}
      // Акта без заказа не бывает (`У-145`), поэтому счёт-основание здесь ни на
      // что не влияет — форма его и не спрашивает.
      hasInvoice={false}
      hasContract={panel.hasContract}
      catalog={panel.catalog}
      defaultSubject={defaultSubject}
      defaultVatRate={panel.defaultVatRate}
      proposalValidDays={panel.proposalValidDays}
    />
  );
}

export function IssueOrderLessDocumentButton({
  organizationId,
  label = 'Создать документ',
  ...prefill
}: { organizationId: string; label?: string } & Prefill) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <IssueOrderLessDocumentDialog
          organizationId={organizationId}
          onClose={() => setOpen(false)}
          {...prefill}
        />
      )}
    </>
  );
}

/**
 * Выпуск коммерческого предложения ЛИДУ (`У-161`, этап 7).
 *
 * Отдельный компонент, а не пропс-«может быть организация, а может лид»:
 * загрузчик другой (`leadIssuePanelAction` со своим гейтом), цель другая, и
 * набор типов документов другой — лиду выставляют только предложение. Один
 * компонент на две цели пришлось бы ветвить в каждой строке.
 *
 * Данные грузятся ПО ОТКРЫТИЮ, как и у организации: карточка лида не должна
 * платить каталогом услуг за кнопку, которую не нажали.
 */
export function IssueLeadProposalButton({
  leadId,
  label = 'Выставить КП',
}: {
  leadId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <IssueLeadProposalDialog leadId={leadId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Внутренний: снаружи открывают кнопкой — вложенных модалок мы не строим. */
function IssueLeadProposalDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [panel, setPanel] = useState<OrgDocumentIssuePanel | null>(null);
  /**
   * У лида с уже заведённой организацией сервис выпускает документ НА
   * ОРГАНИЗАЦИЮ (`loadLeadTarget`). Форма обязана называть настоящую цель:
   * иначе человек видит «предложение лиду», а бумага уходит организации — и
   * ищет её потом не там.
   */
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const fd = new FormData();
      fd.set('leadId', leadId);
      const res = await leadIssuePanelAction(fd);
      if (!alive) return;
      if (!res.ok) {
        // Молчаливо неработающая кнопка — дефект приёмки (§15).
        toast.error(errorMessageRu(res.error));
        onClose();
        return;
      }
      setOrganizationId(res.organizationId ?? null);
      setPanel(res.panel);
    })();
    return () => {
      alive = false;
    };
  }, [leadId, onClose]);

  if (!panel) return null;
  return (
    <IssueDocumentDialog
      open
      onClose={onClose}
      target={organizationId ? { kind: 'organization', organizationId } : { kind: 'lead', leadId }}
      counterpartyName={panel.counterpartyName}
      // Ни заказа, ни его состава у лида нет — строки набирают руками или
      // берут из каталога.
      orderLines={[]}
      missingByType={panel.missingByType}
      baseDocuments={panel.baseDocuments}
      hasInvoice={false}
      hasContract={panel.hasContract}
      catalog={panel.catalog}
      defaultVatRate={panel.defaultVatRate}
      proposalValidDays={panel.proposalValidDays}
      // Лиду выставляют только предложение — тип не выбирают.
      lockedDocType="commercial_proposal"
    />
  );
}
