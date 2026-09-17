'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import { Button } from '@/components/ui';
import { Textarea } from '@/components/ui/textarea';
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
  // `У-238`: ответ клиенту — отдельно от статуса, можно и по закрытому обращению.
  const [replyText, setReplyText] = useState('');

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
  ): Promise<boolean> {
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
        return false;
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
        return true;
      }
      router.refresh();
      return true;
    } catch {
      toast.error('Сетевая ошибка');
      return false;
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

  // `У-238`: ответ клиенту. Поле очищается только после удачной отправки —
  // иначе при сетевой ошибке набранный текст пропал бы.
  const replyForm = (
    <div className="space-y-2" data-testid="client-request-reply">
      <label className="block text-sm font-medium text-[#111111]" htmlFor={`reply-${request.id}`}>
        Ответ клиенту
      </label>
      <Textarea
        id={`reply-${request.id}`}
        rows={3}
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="Заказчик или партнёр увидит этот текст в карточке обращения и в письме"
      />
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={replyText.trim().length === 0}
        onClick={() =>
          void act({ action: 'reply', text: replyText }, 'Ответ отправлен').then((done) => {
            if (done) setReplyText('');
          })
        }
      >
        Ответить
      </Button>
    </div>
  );

  if (!active) {
    // §15: закрытое обращение не молчит — говорит, почему кнопок статуса нет.
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Обращение закрыто — статус больше не меняется, но ответить клиенту можно.
        </p>
        {replyForm}
        {proposalDialog}
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
      </div>
      {replyForm}
      {proposalDialog}
    </div>
  );
}
