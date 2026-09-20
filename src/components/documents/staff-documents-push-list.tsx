'use client';

/**
 * Этап 8 (`У-169`) — список документов сотрудника с массовой выгрузкой в 1С.
 *
 * Обёртка над общим `DocumentsList`: добавляет флажки строк, панель
 * «Выбрано N · Выгрузить выбранные» и итог «поставлено / пропущено с причиной».
 * Сам список остаётся презентационным и общим с кабинетами заказчика и
 * партнёра — у них флажков нет, потому что нет и обёртки (`Р-23`).
 *
 * `У-252`: рядом появилась вторая кнопка — «Скачать выбранные (ZIP)». Столбец
 * флажков у них ОДИН: два столбца рядом человек читал бы как два разных
 * выбора. Поэтому выбрать можно любую строку, а выгрузка в 1С сама берёт из
 * выбора то, что ей годится по типу и состоянию, и честно говорит, сколько
 * строк не взяла. Остальное — правило компании, «пришёл из 1С», права —
 * проверит сервис и вернёт в списке пропущенных. Экран не решает за сервер (§4).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, EmptyState } from '@/components/ui';
import { DocumentsList } from '@/components/partner/documents-list';
import { ZipDownloadButton } from '@/components/documents/zip-download-button';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';
import { isOneCPushableType } from '@/lib/services/oneCSync/schemas';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { requestDocumentPushManyAction } from '@/server-actions/documents/pushToOneC';
import { sendDocumentsToClientsAction } from '@/server-actions/documents/send';

/** Дельты поверх общего словаря — центральные строки этих кодов писались для других экранов. */
const PUSH_ERROR_RU: Record<string, string> = {
  forbidden: 'Нет прав выгружать документы в 1С.',
};

/** Причины пропуска — в строчку после числа («2 — документ уже в очереди…»). */
const SKIP_REASON_RU: Record<string, string> = {
  not_found: 'документ не найден или недоступен',
  forbidden: 'нет прав выгружать документы в 1С',
};

/** Можно ли поставить строку в очередь: подходящий тип и не «уже в очереди / уже в 1С». */
export function canSelectForPush(doc: OrgDocumentRow): boolean {
  if (!isOneCPushableType(doc.type)) return false;
  return doc.oneCPushStatus !== 'pending' && doc.oneCPushStatus !== 'pushed';
}

type PushSummary = {
  queued: number;
  /** Причина → сколько документов пропущено по ней. */
  skipped: Array<{ reason: string; count: number }>;
};

function summarize(res: { queued: number; skipped: Array<{ error: string }> }): PushSummary {
  const byReason = new Map<string, number>();
  for (const s of res.skipped) byReason.set(s.error, (byReason.get(s.error) ?? 0) + 1);
  return {
    queued: res.queued,
    skipped: Array.from(byReason, ([code, count]) => ({
      reason: SKIP_REASON_RU[code] ?? errorMessageRu(code),
      count,
    })),
  };
}

export function StaffDocumentsPushList({
  rows,
  downloadEndpointBase,
  cardHrefBase,
  groupByOrder = false,
  grouping = false,
  resetHref,
}: {
  rows: OrgDocumentRow[];
  downloadEndpointBase: string;
  cardHrefBase: string;
  groupByOrder?: boolean;
  /** `У-253`: переключатель «по типу / по году / по заказу» над списком. */
  grouping?: boolean;
  /**
   * Адрес без фильтра «Выгрузка в 1С». Передан — фильтр активен, и пустой
   * результат объясняет это и даёт кнопку сброса (`У-74`).
   */
  resetHref?: string | undefined;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<PushSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Что из ВЫБРАННОГО годится для 1С. Остальное выбрано ради архива — и это
  // не ошибка человека, поэтому не отказ, а честная строка «не взяли N».
  const pushable = useMemo(
    () => rows.filter((d) => selected.has(d.id) && canSelectForPush(d)),
    [rows, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(rows.map((d) => d.id)));
  }

  function clear() {
    setSelected(new Set());
  }

  async function pushSelected() {
    // Кнопка при пустом наборе `disabled`, поэтому через интерфейс сюда не
    // попасть: проверка стоит на случай нового вызывающего (§11b — помечаем
    // недостижимое, а не изображаем покрытие кликом по выключенной кнопке).
    /* v8 ignore next */
    if (pushable.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    const fd = new FormData();
    // В 1С отправляем только то, что туда вообще может уехать: слать заведомо
    // негодные строки значит получать в ответ список отказов, которого человек
    // не просил.
    for (const doc of pushable) fd.append('documentIds', doc.id);
    const res = await requestDocumentPushManyAction(fd);
    setBusy(false);
    if (!res.ok) {
      setError(PUSH_ERROR_RU[res.error] ?? errorMessageRu(res.error));
      return;
    }
    setSummary(summarize(res));
    setSelected(new Set());
    if (res.queued > 0) {
      toast.success(`Поставлено в очередь на выгрузку в 1С: ${res.queued}.`);
      // Строки с новым «В очереди» приходят с сервера — перечитываем страницу.
      router.refresh();
    }
  }

  /**
   * `У-258`: отправить выбранные бумаги заказчику одним действием.
   *
   * Сервис сам решает, что годится, и возвращает пропущенные с причиной —
   * экран только показывает итог. Молча отправить часть и промолчать про
   * остальное нельзя: сотрудник будет уверен, что клиент получил всё.
   */
  async function sendSelected() {
    // Та же история, что и у выгрузки в 1С: кнопка без выбора `disabled`.
    /* v8 ignore next */
    if (selected.size === 0) return;
    setSending(true);
    setError(null);
    setSummary(null);
    const fd = new FormData();
    for (const id of selected) fd.append('documentIds', id);
    const res = await sendDocumentsToClientsAction(fd);
    setSending(false);
    if (!res.ok) {
      setError(errorMessageRu(res.error));
      return;
    }
    if (res.sent === 0) {
      setError('Ни один из выбранных документов отправить нельзя — проверьте тип и состояние.');
      return;
    }
    setSelected(new Set());
    toast.success(
      res.skipped.length > 0
        ? `Отправлено документов: ${res.sent} в ${res.organizations} орг. Не отправлено: ${res.skipped.length}.`
        : `Отправлено документов: ${res.sent} в ${res.organizations} орг.`
    );
    router.refresh();
  }

  if (rows.length === 0 && resetHref) {
    return (
      <EmptyState
        icon="📄"
        title="По этому фильтру документов нет"
        message="Ни один документ не подходит под выбранное состояние выгрузки в 1С. Снимите фильтр, чтобы увидеть все."
        action={
          <Link
            href={resetHref}
            className="inline-flex items-center rounded-lg bg-[#F97316] px-4 py-2 text-sm font-medium text-white hover:bg-[#EA580C]"
          >
            Сбросить фильтр
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div
          role="toolbar"
          aria-label="Действия над выбранными документами"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm"
        >
          <span className="text-gray-700">{`Выбрано: ${selected.size}`}</span>
          <ZipDownloadButton ids={[...selected]} />
          <Button size="sm" onClick={pushSelected} disabled={pushable.length === 0} loading={busy}>
            {busy ? 'Ставлю в очередь…' : 'Выгрузить выбранные в 1С'}
          </Button>
          {selected.size > pushable.length && (
            // Молчание здесь читалось бы как «кнопка сломалась»: человек выбрал
            // строки, а в 1С уехали не все.
            <span className="text-xs text-gray-500">
              {`В 1С можно выгрузить ${pushable.length} из ${selected.size}`}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void sendSelected()}
            disabled={selected.size === 0}
            loading={sending}
          >
            {sending ? 'Отправляю…' : 'Отправить клиенту'}
          </Button>
          <Button size="sm" variant="ghost" onClick={selectAll} disabled={busy}>
            Выбрать все
          </Button>
          {selected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              Снять выбор
            </Button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2"
        >
          {error}
        </div>
      )}

      {summary && (
        <div
          role="status"
          className="text-sm text-[#111111] bg-[#FFF7ED] border border-orange-100 rounded px-3 py-2 space-y-1"
        >
          <p>
            {`Поставлено в очередь: ${summary.queued}. Пропущено: ${summary.skipped.reduce((n, s) => n + s.count, 0)}.`}
          </p>
          {summary.skipped.length > 0 && (
            <ul className="list-disc pl-5 text-gray-700">
              {summary.skipped.map((s) => (
                <li key={s.reason}>{`${s.count} — ${s.reason}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DocumentsList
        rows={rows}
        downloadEndpointBase={downloadEndpointBase}
        cardHrefBase={cardHrefBase}
        groupByOrder={groupByOrder}
        grouping={grouping}
        selection={{ selected, onToggle: toggle }}
      />
    </div>
  );
}
