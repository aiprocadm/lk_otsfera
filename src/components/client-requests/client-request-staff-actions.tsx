'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { IssueLeadProposalDialog } from '@/components/documents/issue-order-less-document-button';

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
  canIssueProposal = false,
}: {
  request: Pick<ClientRequestRow, 'id' | 'status'>;
  /** Куда вести за созданным лидом — свой кабинет у каждой роли. */
  leadHrefBase: string;
  /**
   * `У-161`: показывать ли «…и выставить КП». Решает СТРАНИЦА, потому что
   * выпуск документов гейтится флагом, а флаг читается на сервере.
   */
  canIssueProposal?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /**
   * `У-161`: лид, который только что создали и которому сразу выставляют
   * предложение. Форма монтируется ЗДЕСЬ, а обновление списка откладывается
   * до её закрытия — иначе `router.refresh()` перерисует обращение как
   * закрытое, компонент уйдёт в ранний выход, и форма умрёт на глазах у
   * человека вместе со всем набранным составом.
   */
  const [proposalForLead, setProposalForLead] = useState<string | null>(null);

  const active = request.status === 'submitted' || request.status === 'in_triage';

  /**
   * `thenIssueProposal` — второй шаг «создать лид и сразу выставить КП».
   *
   * Шага именно ДВА, и склеены они здесь, а не на сервере: набор состава и цен
   * человек делает руками, одним вызовом это не выполнить. Поэтому у каждого
   * шага свой гейт (триаж и выпуск), а в журнале остаются две записи — общая
   * запись врала бы, что действие атомарное.
   */
  async function act(
    body: Record<string, unknown>,
    ok: React.ReactNode,
    thenIssueProposal = false
  ) {
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
      // Тост со ссылкой на лид показан ДО открытия формы нарочно: если форма
      // не откроется (нет прав, нет компании), человек всё равно знает, что
      // лид создан, и знает, куда идти. Обратный порядок оставил бы его с
      // одной непонятной ошибкой и без следа сделанного.
      if (thenIssueProposal && data.leadId) {
        setProposalForLead(data.leadId);
        return;
      }
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  // Форма предложения переживает закрытие обращения: она смонтирована выше
  // раннего выхода, иначе исчезла бы ровно в тот момент, когда нужна.
  const proposalDialog = proposalForLead ? (
    <IssueLeadProposalDialog
      leadId={proposalForLead}
      onClose={() => {
        setProposalForLead(null);
        router.refresh();
      }}
    />
  ) : null;

  if (!active) {
    // §15: закрытое обращение не молчит — говорит, почему кнопок нет.
    return (
      <>
        <p className="text-sm text-gray-500">Обращение закрыто — действий над ним больше нет.</p>
        {proposalDialog}
      </>
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
      {/* `У-161`: обычный путь после обращения — не просто завести лид, а сразу
          назвать цену. Отдельная кнопка, а не замена прежней: заводить лид
          «на потом», не открывая форму, тоже нужно. */}
      {canIssueProposal && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={() => act({ action: 'convertToLead' }, 'Лид создан', true)}
        >
          Принять и выставить КП
        </Button>
      )}
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
      {proposalDialog}
    </div>
  );
}
