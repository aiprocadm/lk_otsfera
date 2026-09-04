import React from 'react';
import { OneCPushStatusSelect } from '@/components/documents/one-c-push-status-select';
import {
  Badge,
  Button,
  EmptyState,
  ExportLink,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
} from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { documentTypeLabelRu } from '@/lib/documents/fileName';
import { ONE_C_PUSH_STATUS_LABEL, ONE_C_PUSH_STATUS_TONE } from '@/lib/documents/oneCPushStatus';
import { errorMessageRu } from '@/lib/errors/messages';
import { fmtDate } from '@/lib/format';
import {
  EXPORT_PACKAGE_LIMIT,
  type ExportCandidate,
  type ExportPackageQuery,
} from '@/lib/services/oneCSync/exportPackage';
import { ONE_C_PUSHABLE_TYPES } from '@/lib/services/oneCSync/schemas';

/**
 * Вкладка «Выгрузка документов» (`У-173`, этап 8) — одна на администратора и
 * руководителя (правило зеркала §15; `Р-23`: презентационный компонент с
 * view-моделью, данные и права даёт сервис через страницу).
 *
 * Три вопроса §15: заголовок и подзаголовок говорят, что здесь собирают
 * пакет для 1С; главная кнопка — «Скачать пакет (N)»; пустой фильтр объясняет,
 * почему пусто, и предлагает сбросить фильтр.
 */
const EXPORT_ROUTE = '/api/integrations/1c/documents/export';

export function OneCDocumentsExportScreen({
  cabinet,
  sp,
  items,
  ready,
  truncated,
}: {
  cabinet: 'admin' | 'leader';
  sp: ExportPackageQuery;
  items: ExportCandidate[];
  ready: number;
  truncated: boolean;
}) {
  const basePath = `/${cabinet}/settings/integrations/1c/documents`;
  const hasFilter = Boolean(sp.from || sp.to || sp.type || sp.oneCPushStatus);
  const download =
    ready > 0 ? (
      <ExportLink
        base={EXPORT_ROUTE}
        params={{ from: sp.from, to: sp.to, type: sp.type, oneCPushStatus: sp.oneCPushStatus }}
        label={`Скачать пакет (${ready})`}
      />
    ) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Выгрузка документов"
        subtitle="Соберите счета, акты и договоры в один архив для 1С: таблица Excel и PDF-файлы. Скачанные документы получат отметку «Выгружен файлом»."
        action={download}
      />

      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Дата выпуска с
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className="border border-gray-200 rounded px-2 py-1 text-sm text-[#111111]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          по
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className="border border-gray-200 rounded px-2 py-1 text-sm text-[#111111]"
          />
        </label>
        <select
          name="type"
          aria-label="Вид документа"
          defaultValue={sp.type ?? ''}
          className="border border-gray-200 rounded px-2 py-1 text-sm"
        >
          <option value="">Вид документа: все</option>
          {ONE_C_PUSHABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {documentTypeLabelRu(t)}
            </option>
          ))}
        </select>
        <OneCPushStatusSelect value={sp.oneCPushStatus} />
        <Button type="submit" variant="secondary" size="sm">
          Показать
        </Button>
      </form>

      {truncated && (
        <p role="status" className="text-sm text-amber-700">
          Найдено больше {EXPORT_PACKAGE_LIMIT} документов — показаны первые {EXPORT_PACKAGE_LIMIT}.
          Сузьте период или вид документа, чтобы пакет был полным.
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon="📦"
          message={
            hasFilter
              ? 'Под этот фильтр документов нет — измените период или сбросьте фильтр.'
              : 'Выгружать пока нечего: нет выпущенных счетов, актов и договоров. В 1С уезжают только они — коммерческие предложения не выгружаются.'
          }
          action={
            hasFilter ? (
              <a href={basePath} className="text-sm text-[#EA580C] hover:underline">
                Сбросить фильтр
              </a>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-gray-700">
            Найдено: {items.length}, войдёт в пакет: {ready}.
            {ready < items.length &&
              ' У остальных не хватает ИНН контрагента или номера — см. колонку «Почему не войдёт».'}
          </p>
          <TableShell overflow="x-auto">
            <THead>
              <Th>Документ</Th>
              <Th>Дата</Th>
              <Th>Контрагент</Th>
              <Th>Выгрузка в 1С</Th>
              <Th>Почему не войдёт</Th>
            </THead>
            <tbody>
              {items.map((d) => (
                <Tr key={d.id} data-testid={`export-candidate-${d.id}`}>
                  <Td className="text-[#111111]">
                    {documentTypeLabelRu(d.type)} {d.number ?? '—'}
                    {d.version > 1 && (
                      <span className="ml-1 text-xs text-gray-500">v{d.version}</span>
                    )}
                  </Td>
                  <Td>{fmtDate(d.createdAt)}</Td>
                  <Td>{d.counterpartyName ?? '—'}</Td>
                  <Td>
                    <Badge tone={ONE_C_PUSH_STATUS_TONE[d.oneCPushStatus]}>
                      {ONE_C_PUSH_STATUS_LABEL[d.oneCPushStatus]}
                    </Badge>
                  </Td>
                  <Td className="text-red-700">{d.blocked ? errorMessageRu(d.blocked) : ''}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}
