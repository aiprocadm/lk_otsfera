'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { TableShell, THead, Th, Tr, Td, EmptyState, Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { fmtDate } from '@/lib/format';
import { ClientRequestStatusBadge } from './client-request-status-badge';
import { InnDuplicateHint } from '@/components/party/inn-duplicate-hint';
import {
  ClientRequestAttachmentsList,
  type ClientRequestAttachmentRowVM
} from './client-request-attachments-list';

const SOURCE_LABEL: Record<ClientRequestRow['source'], string> = {
  partner_cabinet: 'Партнёр',
  organization_cabinet: 'Организация',
  website: 'Сайт'
};

/**
 * Очередь триажа обращений клиентов (этап 5, ФТ-1.4) — по образцу
 * enrollment-queue: таблица + раскрытие строки (описание и вложения) +
 * действия «Взять в работу» / «Принять → создать лид» / «Отклонить».
 */
export function ClientRequestQueue({ rows }: { rows: ClientRequestRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [attachmentsByRequest, setAttachmentsByRequest] = useState<
    Record<string, ClientRequestAttachmentRowVM[] | undefined>
  >({});

  async function toggleOpen(id: string, open: boolean) {
    setOpenId(open ? null : id);
    if (open || attachmentsByRequest[id]) return;
    // Ленивая подгрузка вложений при первом раскрытии; сбой — тихо пустой список.
    try {
      const res = await fetch(`/api/client-requests/${id}/attachments`);
      const body = res.ok
        ? ((await res.json()) as { rows: Array<ClientRequestAttachmentRowVM & { createdAt: string }> })
        : { rows: [] };
      setAttachmentsByRequest((prev) => ({ ...prev, [id]: body.rows }));
    } catch {
      setAttachmentsByRequest((prev) => ({ ...prev, [id]: [] }));
    }
  }

  async function act(id: string, body: Record<string, unknown>, ok: React.ReactNode) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/client-requests/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; leadId?: string };
      if (!res.ok) {
        toast.error(`Не удалось: ${data.error ?? res.status}`);
        return;
      }
      if (body.action === 'convertToLead' && data.leadId) {
        toast.success(
          <span>
            Лид создан —{' '}
            <a href={`/manager/leads/${data.leadId}`} className='underline text-[#F97316]'>
              открыть лид
            </a>
          </span>
        );
      } else {
        toast.success(ok);
      }
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <EmptyState icon='📨' message='Обращений клиентов нет' />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Компания</Th>
        <Th>Контакт</Th>
        <Th>Тема</Th>
        <Th>Податель</Th>
        <Th>Статус</Th>
        <Th>Подано</Th>
        <Th>Действия</Th>
      </THead>
      <tbody>
        {rows.map((r) => {
          const busy = busyId === r.id;
          const open = openId === r.id;
          const active = r.status === 'submitted' || r.status === 'in_triage';
          return (
            <React.Fragment key={r.id}>
              <Tr>
                <Td>
                  <button
                    type='button'
                    onClick={() => toggleOpen(r.id, open)}
                    className='text-left'
                    aria-expanded={open}
                  >
                    <div className='font-medium text-[#111111]'>{r.companyName}</div>
                    <div className='text-xs text-[#F97316]'>
                      {open ? 'Свернуть' : 'Подробнее'}
                      {r.inn && <span className='text-gray-400'> · ИНН {r.inn}</span>}
                    </div>
                  </button>
                </Td>
                <Td className='text-gray-700'>
                  {r.contactName}
                  <div className='text-xs text-gray-500'>
                    {[r.contactPhone, r.contactEmail].filter(Boolean).join(' · ') || '—'}
                  </div>
                </Td>
                <Td className='text-gray-700'>{r.subject}</Td>
                <Td className='text-gray-600'>
                  {r.partnerName ?? r.organizationName ?? r.submittedByName}
                  <div className='text-xs text-gray-400'>{SOURCE_LABEL[r.source]}</div>
                </Td>
                <Td>
                  <ClientRequestStatusBadge status={r.status} />
                  {r.status === 'rejected' && r.rejectedReason && (
                    <div className='text-xs text-gray-500 mt-0.5'>{r.rejectedReason}</div>
                  )}
                </Td>
                <Td className='text-gray-500'>{fmtDate(r.createdAt)}</Td>
                <Td>
                  <div className='flex flex-wrap gap-1.5'>
                    {r.status === 'submitted' && (
                      <Button
                        size='sm'
                        variant='secondary'
                        loading={busy}
                        onClick={() => act(r.id, { action: 'takeInTriage' }, 'Обращение взято в работу')}
                      >
                        Взять в работу
                      </Button>
                    )}
                    {active && (
                      <Button
                        size='sm'
                        variant='primary'
                        loading={busy}
                        onClick={() => act(r.id, { action: 'convertToLead' }, 'Лид создан')}
                      >
                        Принять → создать лид
                      </Button>
                    )}
                    {active && (
                      <Button
                        size='sm'
                        variant='danger'
                        loading={busy}
                        onClick={() => {
                          const reason = window.prompt('Причина отклонения:');
                          if (reason !== null) {
                            act(r.id, { action: 'reject', reason }, 'Обращение отклонено');
                          }
                        }}
                      >
                        Отклонить
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
              {open && (
                <Tr>
                  <Td colSpan={7}>
                    <div className='space-y-3 py-1'>
                      {/* ФТ-13.4: антидубли по ИНН — подсказка менеджеру до
                          «Принять → создать лид»; сабмит не блокирует. */}
                      {r.inn && (
                        <InnDuplicateHint inn={r.inn} cardHrefBase='/manager/organizations' />
                      )}
                      <div className='text-sm text-gray-700 whitespace-pre-wrap'>
                        {r.body || 'Без описания'}
                      </div>
                      <div>
                        <div className='text-xs font-medium text-gray-500 mb-1'>
                          Вложения ({r.attachmentCount})
                        </div>
                        {attachmentsByRequest[r.id] === undefined ? (
                          <div className='text-sm text-gray-500'>Загружаем вложения…</div>
                        ) : (
                          <ClientRequestAttachmentsList
                            requestId={r.id}
                            rows={attachmentsByRequest[r.id] ?? []}
                          />
                        )}
                      </div>
                    </div>
                  </Td>
                </Tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </TableShell>
  );
}
