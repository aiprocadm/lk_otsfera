'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Dialog } from '@/components/ui';
import { RequisitesCard } from '@/components/requisites/requisites-card';
import { setOrgRequisitesByStaffAction } from '@/server-actions/requisites';
import { toast } from '@/lib/ui/toast';
import { requestRequisitesAction } from '@/server-actions/documents/generate';
import { clientRequestLabels, type MissingRequisite } from '@/lib/documents/requisites-check';
import type {
  IssueBaseDocument,
  OrgRequisitesDefaults,
} from '@/lib/services/documents/generationPanel';
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
  cabinet = 'manager',
  organizationId = null,
  organizationRequisites = null,
}: {
  orderId: string;
  counterpartyName: string;
  orderLines: IssueLine[];
  missingByType: Record<IssueDocType, MissingRequisite[]>;
  baseDocuments: IssueBaseDocument[];
  hasInvoice: boolean;
  hasContract: boolean;
  /**
   * `У-278`: кабинет — куда вести за реквизитами исполнителя. Руководитель и
   * администратор правят их сами; менеджеру говорим, кто это делает.
   */
  cabinet?: 'manager' | 'leader' | 'admin';
  /** `У-278`: организация заказа — реквизиты дозаполняются прямо отсюда. */
  organizationId?: string | null;
  organizationRequisites?: OrgRequisitesDefaults | null;
}) {
  const [open, setOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `У-157`: когда реквизиты запрашивали в прошлый раз — показываем рядом
  // с кнопкой, чтобы повтор не выглядел молчаливым отказом.
  const [requestedAt, setRequestedAt] = useState<string | null>(null);

  // Реквизиты счёта — самый частый случай; их нехватку показываем сразу, не
  // заставляя открывать форму, чтобы узнать, что выпустить нечего.
  // Набор полон по типу (`Record<IssueDocType, …>`) — подстраховка `?? []`
  // была недостижимой веткой и только мешала покрытию.
  const invoiceMissing = missingByType.invoice;
  // Договору (и доп. соглашению) нужно БОЛЬШЕ, чем счёту (`У-156`): подписант
  // заказчика, его должность и основание полномочий. Показываем это отдельной
  // строкой — иначе заказчик с полными реквизитами счёта выглядел бы готовым,
  // а договор не выпускался бы без объяснения.
  const contractExtra = missingByType.contract.filter(
    (m) => !invoiceMissing.some((i) => i.side === m.side && i.label === m.label)
  );
  // `У-278` (`Д-59`): нехватка — по СТОРОНАМ, а не одной лентой. ПМ шесть раз
  // правил реквизиты организации, когда не хватало реквизитов исполнителя:
  // смешанный список не говорил, чьи данные и где их заполнять.
  const contractOnly = new Set(contractExtra.map((m) => `${m.side}:${m.label}`));
  const bySide = (side: MissingRequisite['side']) =>
    [...invoiceMissing, ...contractExtra].filter((m) => m.side === side);
  const companyMissing = bySide('company');
  const orgMissing = bySide('organization');
  const canEditCompany = cabinet === 'leader' || cabinet === 'admin';
  const label = (m: MissingRequisite) =>
    contractOnly.has(`${m.side}:${m.label}`) ? `${m.label} — нужно для договора` : m.label;
  // О чём будет письмо клиенту — тем же расчётом, что и само письмо
  // (`requestRequisites`): кнопка не предлагает просить то, чего письмо не
  // спросит, и не молчит о том, что спросит.
  const askLabels = clientRequestLabels((kind) => missingByType[kind]);

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
        const when = new Date(res.requestedAt).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
        });
        setRequestedAt(when);
        toast.error(`Реквизиты уже запрашивали ${when}. Повторить можно через сутки.`);
        return;
      }
      toast.error('Не удалось отправить запрос.');
      return;
    }
    setRequestedAt(new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
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

      {(companyMissing.length > 0 || orgMissing.length > 0) && (
        <div className="mt-3 space-y-3" data-testid="missing-requisites">
          {companyMissing.length > 0 && (
            <div data-testid="missing-company">
              <p className="text-sm text-gray-700">
                Не хватает данных вашей компании (исполнителя):
              </p>
              <ul className="text-sm text-red-600 list-disc pl-5 mt-1 space-y-0.5">
                {companyMissing.map((m) => (
                  <li key={`${m.side}:${m.label}`}>{label(m)}</li>
                ))}
              </ul>
              {canEditCompany ? (
                <Link
                  href={`/${cabinet}/settings/catalogs/requisites`}
                  className="mt-1 inline-block text-sm text-[#F97316] hover:underline"
                >
                  Заполнить реквизиты исполнителя →
                </Link>
              ) : (
                <p className="text-xs text-gray-500 mt-1">
                  Их заполняет руководитель или администратор: «Настройки → Реквизиты исполнителя».
                </p>
              )}
            </div>
          )}
          {orgMissing.length > 0 && (
            <div data-testid="missing-organization">
              <p className="text-sm text-gray-700">
                Не хватает данных организации «{counterpartyName}» (заказчика):
              </p>
              <ul className="text-sm text-red-600 list-disc pl-5 mt-1 space-y-0.5">
                {orgMissing.map((m) => (
                  <li key={`${m.side}:${m.label}`}>{label(m)}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {organizationId && organizationRequisites && (
                  <Button size="sm" onClick={() => setReqOpen(true)}>
                    Заполнить реквизиты организации
                  </Button>
                )}
                {askLabels.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void requestFromClient()}
                  >
                    {busy ? 'Отправляю…' : 'Запросить у клиента'}
                  </Button>
                )}
              </div>
              {requestedAt && (
                <p className="text-xs text-gray-500 mt-1">Запрошено {requestedAt}.</p>
              )}
            </div>
          )}
          <p className="text-xs text-gray-500">
            Договор уже подписан на бумаге? Его не обязательно формировать здесь — прикрепите файл в
            документы заказа.
          </p>
        </div>
      )}

      {organizationId && organizationRequisites && (
        <Dialog
          open={reqOpen}
          onClose={() => setReqOpen(false)}
          title={`Реквизиты организации «${counterpartyName}»`}
          size="lg"
        >
          <RequisitesCard
            defaults={organizationRequisites}
            idPrefix={`order-org-req-${orderId}`}
            action={setOrgRequisitesByStaffAction}
            hidden={{ orgId: organizationId, orderId }}
            onSaved={() => setReqOpen(false)}
          />
        </Dialog>
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
