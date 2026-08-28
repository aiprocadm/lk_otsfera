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
import { Button, Badge, Breadcrumbs } from '@/components/ui';
import type { DocumentDetail } from '@/lib/services/documents/detail';
import { STATUS_LABELS } from '@/lib/documents/statusMatrix';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { acceptDocumentAction } from '@/server-actions/documents/accept';

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
          <Row label="Отправлен">{doc.sentAt ? fmtDate(doc.sentAt) : '—'}</Row>
          <Row label="Принят">{doc.acceptedAt ? fmtDate(doc.acceptedAt) : '—'}</Row>
          <Row label="Размер">{fmtSize(doc.size)}</Row>
          <Row label="Формат файла">{doc.mimeType}</Row>
          <Row label="Подписан">{doc.signedAt ? fmtDate(doc.signedAt) : '—'}</Row>
          <Row label="Загрузил">{doc.uploadedByName ?? '—'}</Row>
          <Row label={COUNTERPARTY_LABELS[doc.counterparty.type] ?? 'Контрагент'}>
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
        </div>
        {accepted && (
          <p className="text-sm text-green-700">
            Документ принят — менеджер уведомлён.
          </p>
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
