'use client';

/**
 * Этап 8 (`У-169`, `У-159`) — блок «Выгрузка в 1С» на карточке документа
 * сотрудника (менеджер, руководитель, зеркало админа).
 *
 * Компонент только показывает то, что посчитал сервер (`DocumentDetail.oneCPush`):
 * статус, время, ошибку и либо кнопку, либо причину, почему кнопки нет.
 * Правило компании, «документ пришёл из 1С» и права здесь не считаются —
 * кнопка на экране правами не является, сервис проверит всё заново (§4).
 *
 * Заказчик и партнёр блока не видят: 1С исполнителя им не принадлежит —
 * поэтому блок живёт отдельно от общей карточки, а не внутри неё.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import type { OneCPushStatus } from '@prisma/client';
import { Badge, Button } from '@/components/ui';
import type { DocumentDetail } from '@/lib/services/documents/detail';
import { ONE_C_PUSH_STATUS_LABEL } from '@/lib/documents/oneCPushStatus';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { requestDocumentPushAction } from '@/server-actions/documents/pushToOneC';

const STATUS_TONE: Record<OneCPushStatus, 'neutral' | 'success' | 'danger' | 'warning'> = {
  none: 'neutral',
  pending: 'warning',
  pushed: 'success',
  failed: 'danger',
  skipped: 'neutral',
  exported_file: 'success',
};

/**
 * Дельты поверх общего словаря: центральные строки писались для других
 * экранов («Заказ не найден», «Нет прав на загрузку») и здесь врали бы.
 */
const PUSH_ERROR_RU: Record<string, string> = {
  not_found: 'Документ не найден или недоступен. Обновите страницу.',
  forbidden: 'Нет прав выгружать документы в 1С.',
};

/** Подпись главной кнопки по состоянию; `null` — кнопки нет (документ уже в 1С). */
function buttonLabel(status: OneCPushStatus): string | null {
  switch (status) {
    case 'pending':
      return 'В очереди…';
    case 'failed':
      return 'Повторить выгрузку';
    case 'pushed':
      return null;
    default:
      return 'Выгрузить в 1С';
  }
}

function fmtDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(d));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="text-gray-500 min-w-0 shrink-0 basis-48">{label}</dt>
      <dd className="text-[#111111] min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function DocumentOneCPushBlock({
  documentId,
  push,
  pushRuleHref,
}: {
  documentId: string;
  push: DocumentDetail['oneCPush'];
  /** Куда вести за правилом компании; `null` — у кабинета нет настроек (менеджер). */
  pushRuleHref: string | null;
}) {
  const [status, setStatus] = useState<OneCPushStatus>(push.status);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    setNote(null);
    const fd = new FormData();
    fd.set('documentId', documentId);
    const res = await requestDocumentPushAction(fd);
    setBusy(false);
    if (!res.ok) {
      setError(PUSH_ERROR_RU[res.error] ?? errorMessageRu(res.error));
      return;
    }
    setStatus('pending');
    setNote(
      res.retry
        ? 'Выгрузка запущена заново — итог появится здесь после обработки.'
        : 'Документ поставлен в очередь — итог появится здесь после обработки.'
    );
    toast.success('Документ отправлен на выгрузку в 1С.');
  }

  const label = buttonLabel(status);

  return (
    <section
      aria-labelledby="onec-push-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
    >
      <h2 id="onec-push-heading" className="text-sm font-semibold text-[#111111]">
        Выгрузка в 1С
      </h2>
      <dl className="space-y-2">
        <Row label="Состояние">
          <Badge tone={STATUS_TONE[status]}>{ONE_C_PUSH_STATUS_LABEL[status]}</Badge>
        </Row>
        {push.pushedAt && (
          <Row label={push.status === 'failed' ? 'Последняя попытка' : 'Когда'}>
            {fmtDateTime(push.pushedAt)}
          </Row>
        )}
        {push.externalId && <Row label="Номер в 1С">{push.externalId}</Row>}
        {push.attempts > 0 && <Row label="Попыток">{push.attempts}</Row>}
        {push.status === 'failed' && push.error && <Row label="Ошибка">{push.error}</Row>}
      </dl>

      {push.blocked ? (
        <p className="text-sm text-gray-500">
          {errorMessageRu(push.blocked)}
          {push.blocked === 'push_disabled' &&
            (pushRuleHref ? (
              <>
                {' '}
                <Link href={pushRuleHref} className="text-[#F97316] hover:underline">
                  Изменить правило
                </Link>
              </>
            ) : (
              ' Попросите руководителя изменить правило в настройках компании.'
            ))}
        </p>
      ) : label ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy || status === 'pending'}
            onClick={() => void request()}
          >
            {busy ? 'Ставлю в очередь…' : label}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Документ уже в 1С. Новая версия после перевыпуска выгружается отдельно.
        </p>
      )}

      {note && <p className="text-sm text-green-700">{note}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
