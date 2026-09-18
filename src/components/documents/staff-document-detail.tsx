import React from 'react';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { DocumentOneCPushBlock } from '@/components/documents/document-onec-push-block';
import { settingsSectionHref } from '@/lib/navigation/settings';
import type { DocumentDetail } from '@/lib/services/documents/detail';
import type { FieldWithValue } from '@/lib/services/customFields';
import { LinkedTasksPanel } from '@/components/tasks/linked-tasks-panel';
import type { TaskCard } from '@/lib/services/tasks/board';
import { DocumentVersionHistory } from '@/components/documents/document-version-history';
import { DocumentVersionUploadForm } from '@/components/documents/document-version-upload-form';
import { DocumentDownloads } from '@/components/documents/document-downloads';
import type { DocumentHistory } from '@/lib/services/documents/history';
import { staffVersionUploadTarget } from '@/lib/documents/versionUpload';

/**
 * Карточка документа сотрудника ЦО — одна на кабинет менеджера и кабинет
 * руководителя (`У-110`). Раньше страница была только у менеджера, и из списка
 * руководителя (которого тоже не было) уходить было некуда.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку, скоуп сессии и `notFound()` делает
 * страница своего кабинета.
 *
 * Все адреса — список, крошки, ссылка на заказ — собираются из `cabinet`:
 * человек остаётся в своём кабинете, а не проваливается в чужой.
 *
 * `canSend` (`У-149`) включён у обоих кабинетов сотрудников: отправлять
 * документ заказчику письмом — их работа. Сервис ещё раз проверит права и
 * тип документа: кнопка на экране правами не считается.
 *
 * Блок «Выгрузка в 1С» (`У-169`) — тоже у обоих; ссылка на правило компании
 * есть только у руководителя (у менеджера хаба настроек нет — блок скажет,
 * к кому идти).
 *
 * `У-251` и `У-254`: история версий, загрузка новой версии и «Кто скачивал» —
 * внутренний контур. Заказчику и партнёру эти блоки не показываются, поэтому
 * они живут здесь, а не в общей карточке пяти кабинетов.
 */
export function StaffDocumentDetail({
  cabinet,
  document,
  customFields,
  tasks,
  currentUserId,
  history = null,
}: {
  cabinet: 'manager' | 'leader';
  document: DocumentDetail;
  customFields: FieldWithValue[];
  /** `У-220`: задачи по документу. `null` — раздел задач выключен, блока нет. */
  tasks?: TaskCard[] | null;
  currentUserId?: string;
  /** `У-251`, `У-254`: версии, скачивания и «в 1С ушла версия N». */
  history?: DocumentHistory | null;
}) {
  const listHref = `/${cabinet}/documents`;
  const versionUpload = staffVersionUploadTarget(document);

  return (
    <DocumentDetailView
      document={document}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: document.name }])}
      orderHrefBase={`/${cabinet}/orders`}
      canSend
      canSetNumber
      canReissue
    >
      <DocumentOneCPushBlock
        documentId={document.id}
        push={document.oneCPush}
        pushRuleHref={settingsSectionHref('catalogs.requisites', cabinet)}
        pushedVersionInOneC={history?.pushedVersionInOneC ?? null}
      />
      {versionUpload && (
        <DocumentVersionUploadForm
          url={versionUpload.url}
          fields={versionUpload.fields}
          documentId={document.id}
          currentVersion={document.version}
        />
      )}
      {history && (
        <DocumentVersionHistory
          versions={history.versions}
          currentId={document.id}
          hrefBase={listHref}
        />
      )}
      {/* `У-254`: журнал действий — раздел настроек администратора; у
          менеджера и руководителя его нет, поэтому ссылки тоже нет. */}
      {history && <DocumentDownloads downloads={history.downloads} auditHref={null} />}
      <EntityCustomFields fields={customFields} entityType="document" entityId={document.id} />
      {tasks && currentUserId && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">Задачи</h2>
          {/* `У-220`: «позвонить по счёту», «получить подписанный акт» — работа
              вокруг бумаги, и заводить её надо там, где бумага, а не искать
              заказ. Документ и КП — одна модель, поэтому блок один. */}
          <LinkedTasksPanel
            link={{ documentId: document.id }}
            tasks={tasks}
            currentUserId={currentUserId}
          />
        </section>
      )}
    </DocumentDetailView>
  );
}
