'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';
import { TableShell, THead, Th, Tr, Td, EmptyState, Button } from '@/components/ui';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { toast } from '@/lib/ui/toast';
import { fmtDate } from '@/lib/format';
import { pluralizeRu } from '@/lib/format';

/**
 * Reviewer queue: manager/leader/admin approve / reject / mark provisioned.
 * Этап 2: заявка = шапка + позиции; строка раскрывается списком слушателей
 * (ФИО, email, должность, СНИЛС, дата рождения, «Дополнительно»).
 */
export function EnrollmentQueue({ rows }: { rows: EnrollmentRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>, ok: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/enrollments/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Не удалось: ${e.error ?? res.status}`);
        return;
      }
      toast.success(ok);
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return <EmptyState icon='🎓' message='Заявок на обучение нет' />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Слушатели</Th>
        <Th>Направление</Th>
        <Th>Кто подал</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
        <Th>Действия</Th>
      </THead>
      <tbody>
        {rows.map((r) => {
          const busy = busyId === r.id;
          const open = openId === r.id;
          return (
            <React.Fragment key={r.id}>
              <Tr>
                <Td>
                  <button
                    type='button'
                    onClick={() => setOpenId(open ? null : r.id)}
                    className='text-left'
                    aria-expanded={open}
                  >
                    <div className='font-medium text-[#111111]'>
                      {r.firstStudentName ?? '—'}
                      {r.studentCount > 1 && <span className='text-gray-500'> и ещё {r.studentCount - 1}</span>}
                    </div>
                    <div className='text-xs text-[#F97316]'>
                      {open ? 'Свернуть' : `${r.studentCount} ${pluralizeRu(r.studentCount, 'слушатель', 'слушателя', 'слушателей')} — показать`}
                    </div>
                  </button>
                </Td>
                <Td className='text-gray-700'>{r.directionName}</Td>
                <Td className='text-gray-600'>
                  {r.partnerName ?? r.organizationName ?? r.submittedByName}
                  <div className='text-xs text-gray-400'>{r.submitterRole}</div>
                </Td>
                <Td>
                  <EnrollmentStatusBadge status={r.status} />
                  {r.status === 'rejected' && r.rejectedReason && (
                    <div className='text-xs text-gray-500 mt-0.5'>{r.rejectedReason}</div>
                  )}
                </Td>
                <Td className='text-gray-500'>{fmtDate(r.createdAt)}</Td>
                <Td>
                  <div className='flex flex-wrap gap-1.5'>
                    {r.status === 'pending' && (
                      <Button size='sm' variant='secondary' loading={busy} onClick={() => act(r.id, { action: 'approve' }, 'Заявка утверждена')}>
                        Утвердить
                      </Button>
                    )}
                    {r.status === 'approved' && (
                      <Button
                        size='sm'
                        variant='primary'
                        loading={busy}
                        onClick={() => {
                          // Для одиночной заявки id из LMS обязателен (как раньше);
                          // для многопозиционной допускается пустой (id по позициям — позже).
                          const sid = window.prompt(
                            r.studentCount <= 1
                              ? 'ID слушателя в LMS (externalStudentId):'
                              : 'Общий ID в LMS (можно оставить пустым):'
                          );
                          if (sid === null) return;
                          if (r.studentCount <= 1 && !sid.trim()) return;
                          act(r.id, { action: 'markProvisioned', externalStudentId: sid.trim() }, 'Отмечено: зачислены');
                        }}
                      >
                        Зачислены
                      </Button>
                    )}
                    {(r.status === 'pending' || r.status === 'approved') && (
                      <Button
                        size='sm'
                        variant='danger'
                        loading={busy}
                        onClick={() => {
                          const reason = window.prompt('Причина отклонения:');
                          if (reason !== null) act(r.id, { action: 'reject', reason }, 'Заявка отклонена');
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
                  <Td colSpan={6}>
                    <ul className='space-y-1.5 py-1'>
                      {r.items.map((item, i) => (
                        <li key={item.id} className='text-sm text-gray-700'>
                          <span className='font-medium text-[#111111]'>{i + 1}. {item.fullName}</span>{' '}
                          <span className='text-xs text-gray-500'>{item.email}</span>
                          {item.position && <span className='text-xs text-gray-500'> · {item.position}</span>}
                          {item.snils && <span className='text-xs text-gray-500'> · СНИЛС {item.snils}</span>}
                          {item.birthDate && (
                            <span className='text-xs text-gray-500'> · род. {fmtDate(item.birthDate)}</span>
                          )}
                          {item.extra && <span className='text-xs text-gray-500'> · {item.extra}</span>}
                          <span className='ml-2'>
                            <EnrollmentStatusBadge status={item.status} />
                          </span>
                          {item.externalStudentId && (
                            <span className='text-xs text-gray-500 ml-1'>LMS: {item.externalStudentId}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {r.note && <div className='text-xs text-gray-500 pb-1'>Примечание: {r.note}</div>}
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
