'use client';
import React from 'react';
import { saveBatchMappingAction } from '@/server-actions/admin/bitrix';
import { useFormAction } from '@/lib/ui/useFormAction';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';
import type { BitrixStage } from '@/lib/services/bitrix/source';
import type { UserMapRow } from '@/lib/services/bitrix/mapping/types';
import {
  BITRIX_TASK_STATUS_LABELS,
  BITRIX_TASK_STATUSES,
} from '@/lib/services/bitrix/mapping/stages';

/**
 * Таблицы сопоставления предпросмотра (`У-193`): стадии сделок, статусы лидов,
 * статусы задач и сотрудники. Всё в ОДНОЙ форме с одной кнопкой: человек
 * решает разом, а не по строчке — иначе на середине непонятно, сохранено ли.
 *
 * Незаполненная стадия — не ошибка формы, а прямой запрет на применение: пока
 * в списке есть «— выберите —», пакет применить нельзя, и страница это скажет.
 */
export type Option = { id: string; name: string };

export type MappingTablesProps = {
  batchId: string;
  stages: BitrixStage[];
  users: UserMapRow[];
  dealStages: Option[];
  funnelStages: Option[];
  taskColumns: Option[];
  companyUsers: Option[];
  values: {
    stageMap: Record<string, string | null>;
    leadStageMap: Record<string, string | null>;
    taskColumnMap: Record<string, string | null>;
    userMap: Record<string, string>;
  };
  disabled?: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Миграция из Битрикс24 выключена или у вас нет прав на раздел.',
  not_found: 'Пакет не найден — возможно, его удалили.',
  invalid: 'Сопоставление можно менять, пока пакет не применён.',
};

export function MappingTables(props: MappingTablesProps) {
  const { formAction, pending, errorText, success } = useFormAction<object>({
    action: saveBatchMappingAction,
    errorMap: ERROR_LABELS,
    refresh: true,
  });

  const dealStages = props.stages.filter((s) => s.entity === 'deal');
  const leadStages = props.stages.filter((s) => s.entity === 'lead');

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="batchId" value={props.batchId} />

      <MapTable
        title="Стадии сделок"
        hint="Слева — стадии вашего портала, справа — стадии сделок в личном кабинете."
        rows={dealStages.map((s) => ({
          key: `${s.categoryId ?? '0'}:${s.id}`,
          label: s.name,
          field: `stage:${s.categoryId ?? '0'}:${s.id}`,
          value: props.values.stageMap[`${s.categoryId ?? '0'}:${s.id}`] ?? '',
        }))}
        options={props.dealStages}
        disabled={props.disabled}
      />

      <MapTable
        title="Статусы лидов"
        hint="Куда попадут лиды из Битрикса в воронке кабинета."
        rows={leadStages.map((s) => ({
          key: s.id,
          label: s.name,
          field: `leadStage:${s.id}`,
          value: props.values.leadStageMap[s.id] ?? '',
        }))}
        options={props.funnelStages}
        disabled={props.disabled}
      />

      <MapTable
        title="Статусы задач"
        hint="В какую колонку доски задач положить задачу с таким статусом."
        rows={BITRIX_TASK_STATUSES.map((status) => ({
          key: String(status),
          label: BITRIX_TASK_STATUS_LABELS[status],
          field: `taskColumn:${status}`,
          value: props.values.taskColumnMap[String(status)] ?? '',
        }))}
        options={props.taskColumns}
        disabled={props.disabled}
      />

      <MapTable
        title="Сотрудники"
        hint="Кому в кабинете достанутся записи сотрудника портала. Пусто — менеджеру по умолчанию."
        rows={props.users.map((u) => ({
          key: u.bitrixId,
          label: u.email ? `${u.name} (${u.email})` : u.name,
          field: `user:${u.bitrixId}`,
          value: props.values.userMap[u.bitrixId] ?? u.userId ?? '',
        }))}
        options={props.companyUsers}
        emptyOption="— менеджер по умолчанию —"
        disabled={props.disabled}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || props.disabled}>
          {pending ? 'Сохраняем…' : 'Сохранить сопоставление'}
        </Button>
        <p role="status" className={success ? 'text-sm text-green-700' : 'sr-only'}>
          {success ? 'Сопоставление сохранено.' : ''}
        </p>
      </div>
      <p role="alert" className={errorText ? 'text-sm text-red-600' : 'sr-only'}>
        {errorText}
      </p>
    </form>
  );
}

type MapRow = { key: string; label: string; field: string; value: string };

function MapTable({
  title,
  hint,
  rows,
  options,
  emptyOption = '— выберите —',
  disabled,
}: {
  title: string;
  hint: string;
  rows: MapRow[];
  options: Option[];
  emptyOption?: string;
  disabled?: boolean | undefined;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-[#111111]">{title}</h3>
        <p className="text-sm text-gray-600">{hint}</p>
      </div>
      <TableShell overflow="x-auto">
        <caption className="sr-only">{title}</caption>
        <THead>
          <Th>В Битрикс24</Th>
          <Th>В личном кабинете</Th>
        </THead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td className="font-medium text-gray-900">{row.label}</Td>
              <Td>
                <Select
                  aria-label={`${title}: ${row.label}`}
                  name={row.field}
                  defaultValue={row.value}
                  disabled={disabled}
                >
                  <option value="">{emptyOption}</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}
