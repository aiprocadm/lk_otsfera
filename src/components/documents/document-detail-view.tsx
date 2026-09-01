'use client';

/**
 * §11 ТЗ v0.5 (этап 1, PR-4) — карточка документа.
 *
 * Один компонент на все кабинеты: документ — не расходящийся по доменам
 * объект, различаются только ссылки «назад» и на заказ. Sibling-паттерн
 * §4 CLAUDE.md неприменим (компонент презентационный, принимает
 * domain-agnostic `DocumentDetail`).
 *
 * Файл отдаётся **только через presigned URL** (§10 CLAUDE.md): кнопка
 * запрашивает ссылку у роута и открывает её, приложение файл не проксирует.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import type { Crumb } from '@/lib/navigation/breadcrumbs';
import { Button, Badge, Breadcrumbs, Field, Input } from '@/components/ui';
import type { DocumentDetail } from '@/lib/services/documents/detail';
import { canSendFromStatus, STATUS_LABELS } from '@/lib/documents/statusMatrix';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { acceptDocumentAction } from '@/server-actions/documents/accept';
import { sendDocumentAction } from '@/server-actions/documents/send';
import { setDocumentNumberAction } from '@/server-actions/documents/number';
import { ReissueDocumentButton } from '@/components/documents/reissue-document-button';
import { PAYMENT_STATE_LABELS } from '@/lib/documents/invoicePayment';

import { PageHeader } from '@/components/ui/page-header';
const TYPE_LABELS: Record<string, string> = {
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
  invoice: 'Счёт',
  act: 'Акт',
  waybill: 'Накладная',
  certificate: 'Сертификат',
  report: 'Отчёт',
  commission_statement: 'Расчёт комиссии',
  commercial_proposal: 'Коммерческое предложение',
  other: 'Прочее',
};

const DIRECTION_LABELS: Record<string, string> = {
  incoming: 'Входящий',
  outgoing: 'Исходящий',
};

const COUNTERPARTY_LABELS: Record<string, string> = {
  organization: 'Организация',
  partner: 'Партнёр',
};

export function fmtSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

function fmtDate(d: Date | string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
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

// ─── Скачивание ──────────────────────────────────────────────────────────────

function DownloadButton({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/download`, { method: 'POST' });
      if (!res.ok) {
        // 410 Gone — файл в карантине: это НЕ «не найдено», сообщение другое.
        setError(
          res.status === 410
            ? 'Файл заблокирован антивирусом и недоступен для скачивания.'
            : 'Не удалось получить ссылку на файл. Попробуйте ещё раз.'
        );
        return;
      }
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleDownload} disabled={busy}>
        {busy ? 'Готовим ссылку…' : 'Скачать файл'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Карточка ────────────────────────────────────────────────────────────────

export type DocumentDetailViewProps = {
  document: DocumentDetail;
  /** Куда ведёт «назад» — список документов своего кабинета. */
  backHref: string;
  /**
   * Крошки вместо ссылки «назад» (`У-72`): первая крошка ведёт в тот же
   * раздел, два навигационных элемента подряд не нужны. Проп опциональный —
   * экран без крошек показывает прежнюю ссылку.
   */
  breadcrumbs?: Crumb[] | undefined;
  /** База ссылки на заказ в этом кабинете, например `/manager/orders`. Нет — ссылка не рисуется. */
  orderHrefBase?: string;
  /**
   * `У-150`: кабинет заказчика показывает кнопку «Принять» для акта, договора
   * и доп. соглашения. У сотрудников кнопки нет — они принимают документ
   * своим действием, и общая карточка не должна давать им чужую.
   */
  canAccept?: boolean;
  /**
   * `У-149`: сотрудник исполнителя отправляет документ заказчику письмом.
   * У заказчика этой кнопки нет — документ и так лежит в его кабинете.
   */
  canSend?: boolean;
  /**
   * `У-151` (дефект `Д-5`): сотрудник ЦО может вписать номер документу,
   * приехавшему из 1С без номера. Без номера такой счёт не годится в
   * основание акта, и раньше человек упирался в отказ «сначала выпустите
   * счёт», глядя на счёт.
   */
  canSetNumber?: boolean;
  /**
   * `У-151`: перевыпуск — новая версия с тем же номером. Только у сотрудников
   * ЦО: заказчик и партнёр документы не выпускают.
   */
  canReissue?: boolean;
  /** Секция настраиваемых полей §11 (рендерится страницей). */
  children?: React.ReactNode;
};

/** Состояние по-русски; незнакомый код показываем прочерком, а не сырым словом. */
function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? '—';
}

export function DocumentDetailView({
  document: doc,
  backHref,
  breadcrumbs,
  orderHrefBase,
  canAccept = false,
  canSend = false,
  canSetNumber = false,
  canReissue = false,
  children,
}: DocumentDetailViewProps) {
  const infected = doc.scanStatus === 'infected';
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(doc.status === 'accepted');
  // Принимают подписываемые бумаги. Счёт не принимают вручную: его состояние
  // определяют платежи (`У-148`), кнопка «Оплачено» у клиента была бы
  // способом объявить оплату, которой не было.
  const acceptable = ['act', 'contract', 'extra_agreement'].includes(doc.type);
  const showAccept = canAccept && acceptable && !accepted && doc.status !== 'cancelled';

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // `У-151` (`Д-5`): номер документа из 1С вписывается прямо здесь.
  const [numberDraft, setNumberDraft] = useState('');
  const [numberBusy, setNumberBusy] = useState(false);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [numberSet, setNumberSet] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  // Отправляют письмом бумаги с жизненным циклом и только заказчику. Скан,
  // отчёт и документы партнёра этой кнопки не получают: адресата у них нет.
  // Списки типов и статусов НЕ переписаны сюда литералами: экран и сервис
  // разъехались бы при первой правке. Так и вышло бы с КП (`У-164`) — он
  // отправляется из ЧЕРНОВИКА, и прежний литерал `['issued','sent','accepted']`
  // прятал бы у него кнопку, хотя сервис отправку разрешает.
  const sendable =
    canSendFromStatus(doc.type, doc.status) && doc.counterparty.type === 'organization';
  /**
   * Дельты поверх общего словаря: центральные строки писались для других
   * экранов («Заказ не найден», «Нет прав на загрузку») и здесь врали бы про
   * то, что произошло (§15 — ошибка обязана быть понятной).
   */
  const NUMBER_ERROR_RU: Record<string, string> = {
    not_found: 'Документ не найден или недоступен. Обновите страницу.',
    forbidden: 'Нет прав указывать номер документа.',
  };

  async function saveNumber() {
    setNumberBusy(true);
    setNumberError(null);
    const fd = new FormData();
    fd.set('documentId', doc.id);
    fd.set('number', numberDraft);
    try {
      const res = await setDocumentNumberAction(fd);
      if (!res.ok) {
        setNumberError(NUMBER_ERROR_RU[res.error] ?? errorMessageRu(res.error));
        return;
      }
      // Пропсы приходят с сервера и после действия не меняются: показываем
      // вписанный номер сразу, иначе экран выглядел бы «ничего не произошло».
      setNumberSet(numberDraft.trim());
    } catch {
      setNumberError(errorMessageRu('network'));
    } finally {
      setNumberBusy(false);
    }
  }

  const showSend = canSend && sendable && !infected;
  // Номер вписывают только там, где его нет: у выпущенного нами документа он
  // напечатан в файле, и правка развела бы бумагу с записью.
  const showSetNumber = canSetNumber && doc.number === null;
  // Перевыпускают выпущенную нами бумагу с номером, которая ещё действует.
  // Сервер проверит то же самое: кнопка правами не считается.
  const showReissue = canReissue && doc.number !== null && !infected;

  async function accept() {
    setAccepting(true);
    setAcceptError(null);
    const fd = new FormData();
    fd.set('documentId', doc.id);
    const res = await acceptDocumentAction(fd);
    setAccepting(false);
    if (!res.ok) {
      setAcceptError(errorMessageRu(res.error));
      return;
    }
    setAccepted(true);
    toast.success('Документ принят.');
  }

  async function sendToCustomer() {
    setSending(true);
    setSendError(null);
    setSentNote(null);
    const fd = new FormData();
    fd.set('documentId', doc.id);
    const res = await sendDocumentAction(fd);
    setSending(false);
    if (!res.ok) {
      setSendError(errorMessageRu(res.error));
      return;
    }
    const addressees = res.recipients === 1 ? 'на 1 адрес' : `на ${res.recipients} адр.`;
    setSentNote(
      res.attached
        ? `Документ отправлен ${addressees} — файл приложен к письму.`
        : `Письмо отправлено ${addressees}, но приложить файл не удалось — клиент откроет документ по ссылке.`
    );
    toast.success('Документ отправлен заказчику.');
  }

  return (
    <div className="space-y-5">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <Link href={backHref} className="text-sm text-[#F97316] hover:underline">
            ← Документы
          </Link>
        )}
        {/* `У-120`: карточка сущности — подзаголовок из её же данных. */}
        <PageHeader
          title={doc.name}
          subtitle={
            <>
              {TYPE_LABELS[doc.type] ?? doc.type} ·{' '}
              {DIRECTION_LABELS[doc.direction] ?? doc.direction} · загружен {fmtDate(doc.createdAt)}
            </>
          }
        />
      </div>

      {infected && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <strong>Файл заблокирован антивирусом.</strong> Скачивание недоступно.
          {doc.scanReason ? ` Причина: ${doc.scanReason}.` : ''}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-[#111111]">Сведения о документе</h2>
        <dl className="space-y-2">
          <Row label="Номер">{doc.number ?? '—'}</Row>
          <Row label="Версия">{doc.version}</Row>
          <Row label="Состояние">{statusLabel(accepted ? 'accepted' : doc.status)}</Row>
          <Row label="Сумма">{doc.amountGross === null ? '—' : `${doc.amountGross} ₽`}</Row>
          {doc.payment && (
            <Row label="Оплата">
              {PAYMENT_STATE_LABELS[doc.payment.state]}
              {doc.payment.paid > 0 && doc.payment.state !== 'paid'
                ? ` — поступило ${doc.payment.paid.toLocaleString('ru-RU')} ₽`
                : ''}
              {!doc.payment.matched && (
                <span className="block text-gray-500">
                  {doc.payment.ambiguous
                    ? 'В назначении платежа названо несколько счетов — сумму не разнести.'
                    : 'Платежей с ссылкой на этот счёт не найдено.'}
                </span>
              )}
            </Row>
          )}
          <Row label="Отправлен">{doc.sentAt ? fmtDate(doc.sentAt) : '—'}</Row>
          <Row label="Принят">{doc.acceptedAt ? fmtDate(doc.acceptedAt) : '—'}</Row>
          <Row label="Размер">{fmtSize(doc.size)}</Row>
          <Row label="Формат файла">{doc.mimeType}</Row>
          <Row label="Подписан">{doc.signedAt ? fmtDate(doc.signedAt) : '—'}</Row>
          <Row label="Загрузил">{doc.uploadedByName ?? '—'}</Row>
          <Row
            label={
              (doc.counterparty.type && COUNTERPARTY_LABELS[doc.counterparty.type]) || 'Контрагент'
            }
          >
            {doc.counterparty.name ?? '—'}
          </Row>
          <Row label="Заказ">
            {doc.order ? (
              orderHrefBase ? (
                <Link
                  href={`${orderHrefBase}/${doc.order.id}`}
                  className="text-[#F97316] hover:underline"
                >
                  {doc.order.orderNumber ?? doc.order.title}
                </Link>
              ) : (
                (doc.order.orderNumber ?? doc.order.title)
              )
            ) : (
              'Общий документ (вне заказа)'
            )}
          </Row>
          <Row label="Проверка антивирусом">
            {infected ? (
              <Badge tone="danger">заблокирован</Badge>
            ) : doc.scanStatus === 'clean' ? (
              <Badge tone="success">чисто</Badge>
            ) : (
              <Badge tone="neutral">идёт проверка</Badge>
            )}
          </Row>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {!infected && <DownloadButton documentId={doc.id} />}
          {showAccept && (
            <Button variant="secondary" disabled={accepting} onClick={() => void accept()}>
              {accepting ? 'Принимаю…' : doc.type === 'act' ? 'Принять' : 'Подписать'}
            </Button>
          )}
          {showSend && (
            <Button variant="secondary" disabled={sending} onClick={() => void sendToCustomer()}>
              {sending ? 'Отправляю…' : doc.sentAt ? 'Отправить ещё раз' : 'Отправить заказчику'}
            </Button>
          )}
          {showReissue && <ReissueDocumentButton documentId={doc.id} />}
        </div>

        {/* `У-151` (`Д-5`): счёт и договор из 1С приходят без номера, а без
            номера они не годятся в основание акта. Раньше человек упирался в
            отказ «сначала выпустите счёт», глядя на счёт. */}
        {showSetNumber && !numberSet && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-gray-800">
              У документа нет номера — он пришёл из 1С. Впишите номер с бумаги, и по нему можно
              будет выпустить акт.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Field htmlFor="doc-number" label="Номер документа">
                <Input
                  id="doc-number"
                  value={numberDraft}
                  onChange={(e) => setNumberDraft(e.target.value)}
                  placeholder="например, С-2026-17"
                />
              </Field>
              <Button
                variant="secondary"
                disabled={numberBusy || numberDraft.trim() === ''}
                onClick={() => void saveNumber()}
              >
                {numberBusy ? 'Сохраняю…' : 'Указать номер'}
              </Button>
            </div>
            {numberError && (
              <p role="alert" className="text-sm text-red-600 mt-2">
                {numberError}
              </p>
            )}
          </div>
        )}
        {numberSet && <p className="text-sm text-green-700">Номер сохранён: {numberSet}.</p>}

        {sentNote && <p className="text-sm text-green-700">{sentNote}</p>}
        {sendError && (
          <p role="alert" className="text-sm text-red-600">
            {sendError}
          </p>
        )}
        {accepted && (
          <p className="text-sm text-green-700">Документ принят — менеджер уведомлён.</p>
        )}
        {acceptError && (
          <p role="alert" className="text-sm text-red-600">
            {acceptError}
          </p>
        )}
      </div>

      {children}
    </div>
  );
}
