'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';
import { TableShell, THead, Th, Tr, Td, EmptyState, Button } from '@/components/ui';
import { EnrollmentStatusBadge } from './enrollment-status-badge';
import { toast } from '@/lib/ui/toast';
import { fmtDate } from '@/lib/format';

/** Reviewer queue: manager/leader/admin approve / reject / mark provisioned. */
export function EnrollmentQueue({ rows }: { rows: EnrollmentRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

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
        <Th>Слушатель</Th>
        <Th>Курс</Th>
        <Th>Кто подал</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
        <Th>Действия</Th>
      </THead>
      <tbody>
        {rows.map((r) => {
          const busy = busyId === r.id;
          return (
            <Tr key={r.id}>
              <Td>
                <div className='font-medium text-[#111111]'>{r.studentName}</div>
                <div className='text-xs text-gray-500'>{r.studentEmail}</div>
              </Td>
              <Td className='text-gray-700'>{r.courseTitle}</Td>
              <Td className='text-gray-600'>
                {r.partnerName ?? r.organizationName ?? r.submittedByName}
                <div className='text-xs text-gray-400'>{r.submitterRole}</div>
              </Td>
              <Td>
                <EnrollmentStatusBadge status={r.status} />
                {r.status === 'provisioned' && r.externalStudentId && (
                  <div className='text-xs text-gray-500 mt-0.5'>LMS: {r.externalStudentId}</div>
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
                        const sid = window.prompt('ID слушателя в LMS (externalStudentId):');
                        if (sid !== null && sid.trim()) act(r.id, { action: 'markProvisioned', externalStudentId: sid.trim() }, 'Отмечено: заведён в LMS');
                      }}
                    >
                      Заведён в LMS
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
          );
        })}
      </tbody>
    </TableShell>
  );
}
