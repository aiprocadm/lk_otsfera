import React from 'react';
import {
  ONE_C_PUSH_STATUS_LABEL,
  ONE_C_PUSH_STATUS_ORDER,
  parseOneCPushStatus,
} from '@/lib/documents/oneCPushStatus';

/**
 * `У-169`: фильтр «Выгрузка в 1С» над списками документов сотрудников —
 * один и тот же у менеджера, руководителя и в зеркале админа (правило
 * зеркала §15), чтобы «Ошибка выгрузки» искалась везде одинаково.
 *
 * Обычный `<select>` GET-формы: страница читает `?oneCPushStatus=` и отдаёт
 * его сервису уже разобранным (`parseOneCPushStatus`).
 */
export function OneCPushStatusSelect({ value }: { value: string | undefined }) {
  return (
    <select
      name="oneCPushStatus"
      aria-label="Выгрузка в 1С"
      defaultValue={parseOneCPushStatus(value) ?? ''}
      className="border border-gray-200 rounded px-2 py-1 text-sm"
    >
      <option value="">Выгрузка в 1С: все</option>
      {ONE_C_PUSH_STATUS_ORDER.map((status) => (
        <option key={status} value={status}>
          {ONE_C_PUSH_STATUS_LABEL[status]}
        </option>
      ))}
    </select>
  );
}
