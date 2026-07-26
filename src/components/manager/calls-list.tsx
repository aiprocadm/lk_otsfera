import React from 'react';
import { TableShell, THead, Th, Tr, Td, Badge, EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { CallBindForm } from '@/components/manager/contacts/call-bind-form';
import { SourceIntakeActions } from '@/components/intake/source-intake-actions';

/**
 * Task 9b — презентационный список звонков (B4 UI). Переиспользуется в двух
 * местах: `/manager/calls` (полный список + фильтры) и таб «Звонки» в
 * CRM-карточке организации (read-only, без фильтров). Сервер-компонент — сама
 * не ходит за данными, только рендерит `items` от `listCalls`/`getOrganizationCard`.
 *
 * Recording-ячейка читает `recordingScanStatus`/`hasRecording` и НИКОГДА не
 * получает `recordingPath` напрямую (сервисный слой его не отдаёт) — ссылка
 * всегда указывает на `/api/manager/calls/[id]/recording`, который сам
 * переповторяет company-scope + clean-gate на сервере.
 *
 * Task 10 — call-triage: строки с `resolvedOrgId == null` (нераспознанный
 * звонок) получают `CallBindForm`, но ТОЛЬКО когда `contactsEnabled` (флаг
 * `contacts`, передаётся страницей). Распознанные звонки остаются read-only —
 * `orgs`/`contactsEnabled` опциональны, т.к. read-only места (CRM-таб)
 * продолжают рендерить список без формы.
 */

export type CallListItem = {
  id: string;
  direction: string;
  callerNumber: string;
  internalNumber: string | null;
  status: string;
  durationSec: number | null;
  startedAt: Date | null;
  createdAt: Date;
  resolvedOrgId: string | null;
  recordingScanStatus: string;
  hasRecording: boolean;
};

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Входящий',
  outbound: 'Исходящий'
};

const DIRECTION_TONE: Record<string, 'success' | 'info'> = {
  inbound: 'success',
  outbound: 'info'
};

function fmtDuration(sec: number | null): string {
  if (sec == null || Number.isNaN(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function RecordingCell({ item }: { item: CallListItem }) {
  if (!item.hasRecording) {
    return <span className="text-xs text-gray-400">Нет записи</span>;
  }
  if (item.recordingScanStatus === 'infected') {
    return <Badge tone="danger">Заражено</Badge>;
  }
  if (item.recordingScanStatus === 'clean') {
    return (
      <a
        href={`/api/manager/calls/${item.id}/recording`}
        className="text-sm font-medium text-[#EA580C] hover:underline"
      >
        Прослушать
      </a>
    );
  }
  // pending / none / error → ещё не готово к скачиванию.
  return <Badge tone="neutral">Проверяется</Badge>;
}

export function CallsList({
  items,
  orgs = [],
  contactsEnabled = false,
  currentUserId = ''
}: {
  items: CallListItem[];
  orgs?: { id: string; name: string }[];
  contactsEnabled?: boolean;
  /** Этап 7 (ФТ-1.6/7.5): включает «Создать лид»/«Задача» на входящих. */
  currentUserId?: string;
}) {
  if (items.length === 0) {
    return <EmptyState icon="📞" message="Звонков нет" />;
  }

  return (
    <div className="space-y-3">
      <TableShell overflow="x-auto" className="hidden md:block">
        <THead>
          <Th>Направление</Th>
          <Th>Номер</Th>
          <Th>Внутренний</Th>
          <Th>Статус</Th>
          <Th>Длительность</Th>
          <Th>Дата</Th>
          <Th>Запись</Th>
          {contactsEnabled && <Th>Привязка</Th>}
          {currentUserId && <Th>Действия</Th>}
        </THead>
        <tbody>
          {items.map((item) => (
            <Tr key={item.id}>
              <Td>
                <Badge tone={DIRECTION_TONE[item.direction] ?? 'neutral'}>
                  {DIRECTION_LABEL[item.direction] ?? item.direction}
                </Badge>
              </Td>
              <Td className="text-gray-700">{item.callerNumber}</Td>
              <Td className="text-gray-500">{item.internalNumber ?? '—'}</Td>
              <Td className="text-gray-500">{item.status}</Td>
              <Td className="text-gray-500">{fmtDuration(item.durationSec)}</Td>
              <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(item.createdAt)}</Td>
              <Td>
                <RecordingCell item={item} />
              </Td>
              {contactsEnabled && (
                <Td>
                  {item.resolvedOrgId == null ? (
                    <CallBindForm callId={item.id} callerNumber={item.callerNumber} orgs={orgs} />
                  ) : (
                    <span className="text-xs text-gray-400">Привязан</span>
                  )}
                </Td>
              )}
              {currentUserId && (
                <Td>
                  {item.direction === 'inbound' ? (
                    <SourceIntakeActions
                      kind="call"
                      sourceId={item.id}
                      leadPrefill={{
                        companyName: '',
                        contactName: item.callerNumber,
                        contactPhone: item.callerNumber,
                        contactEmail: '',
                        subject: 'Входящий звонок'
                      }}
                      taskTitle={`Перезвонить: ${item.callerNumber}`}
                      organizationId={item.resolvedOrgId}
                      currentUserId={currentUserId}
                    />
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {/* Мобильная раскладка — карточки вместо широкой таблицы. */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge tone={DIRECTION_TONE[item.direction] ?? 'neutral'}>
                {DIRECTION_LABEL[item.direction] ?? item.direction}
              </Badge>
              <span className="text-xs text-gray-400">{fmtDateTime(item.createdAt)}</span>
            </div>
            <p className="mt-2 text-sm text-gray-700">{item.callerNumber}</p>
            {item.internalNumber && (
              <p className="text-xs text-gray-500">Внутр.: {item.internalNumber}</p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
              <span>{item.status}</span>
              <span>{fmtDuration(item.durationSec)}</span>
            </div>
            <div className="mt-2">
              <RecordingCell item={item} />
            </div>
            {contactsEnabled && item.resolvedOrgId == null && (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <CallBindForm callId={item.id} callerNumber={item.callerNumber} orgs={orgs} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
