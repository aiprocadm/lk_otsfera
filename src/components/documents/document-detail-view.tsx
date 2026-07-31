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
import { Button, Badge } from '@/components/ui';
import type { DocumentDetail } from '@/lib/services/documents/detail';

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
  /** База ссылки на заказ в этом кабинете, например `/manager/orders`. Нет — ссылка не рисуется. */
  orderHrefBase?: string;
  /** Секция настраиваемых полей §11 (рендерится страницей). */
  children?: React.ReactNode;
};

export function DocumentDetailView({
  document: doc,
  backHref,
  orderHrefBase,
  children,
}: DocumentDetailViewProps) {
  const infected = doc.scanStatus === 'infected';

  return (
    <div className="space-y-5">
      <div>
        <Link href={backHref} className="text-sm text-[#F97316] hover:underline">
          ← Документы
        </Link>
        <h1 className="text-2xl font-bold text-[#111111] mt-1">{doc.name}</h1>
        <p className="text-sm text-gray-500">
          {TYPE_LABELS[doc.type] ?? doc.type} · {DIRECTION_LABELS[doc.direction] ?? doc.direction} ·
          загружен {fmtDate(doc.createdAt)}
        </p>
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

        {!infected && <DownloadButton documentId={doc.id} />}
      </div>

      {children}
    </div>
  );
}
