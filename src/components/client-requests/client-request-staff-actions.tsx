'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

/**
 * Действия сотрудника над обращением (`У-116`).
 *
 * Раньше они жили только в раскрывающейся строке очереди: чтобы взять обращение
 * в работу или отклонить, приходилось разворачивать строку прямо в списке.
 * Открыть обращение отдельным экраном было нельзя — деталка существовала только
 * у клиента, который его подал.
 *
 * Компонент один на очередь и на деталку: правило перехода статусов живёт на
 * сервере (`PATCH /api/client-requests/[id]`), здесь только кнопки и понятные
 * сообщения.
 */
export function ClientRequestStaffActions({
  request,
  leadHrefBase,
}: {
  request: Pick<ClientRequestRow, 'id' | 'status'>;
  /** Куда вести за созданным лидом — свой кабинет у каждой роли. */
  leadHrefBase: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const active = request.status === 'submitted' || request.status === 'in_triage';

  async function act(body: Record<string, unknown>, ok: React.ReactNode) {
    setBusy(true);
    try {
      const res = await fetch(`/api/client-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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
            <a href={`${leadHrefBase}/${data.leadId}`} className="underline text-[#F97316]">
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
      setBusy(false);
    }
  }

  if (!active) {
    // §15: закрытое обращение не молчит — говорит, почему кнопок нет.
    return (
      <p className="text-sm text-gray-500">Обращение закрыто — действий над ним больше нет.</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {request.status === 'submitted' && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => act({ action: 'takeInTriage' }, 'Обращение взято в работу')}
        >
          Взять в работу
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() => act({ action: 'convertToLead' }, 'Лид создан')}
      >
        Принять → создать лид
      </Button>
      <Button
        size="sm"
        variant="danger"
        loading={busy}
        onClick={() => {
          const reason = window.prompt('Причина отклонения:');
          if (reason !== null) void act({ action: 'reject', reason }, 'Обращение отклонено');
        }}
      >
        Отклонить
      </Button>
    </div>
  );
}
