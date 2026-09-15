import Link from 'next/link';
import React from 'react';
import { EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { DialogMessageView } from '@/lib/services/messengers/get';

/** Размер файла человеку: «240 КБ», «1,4 МБ». */
function formatSize(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}

/**
 * Файл в сообщении (`У-204`). Ссылка появляется только у проверенного файла:
 * пока идёт проверка — честная подпись «проверяется», у заражённого — прямая
 * «файл заблокирован», а не молчаливая неработающая ссылка.
 */
function Attachment({ dialogId, message }: { dialogId: string; message: DialogMessageView }) {
  const att = message.attachment;
  if (!att) return null;
  const size = formatSize(att.size);
  const label = size ? `${att.name} · ${size}` : att.name;

  if (att.scanStatus === 'infected') {
    return (
      <p className="mt-1 text-xs text-red-600">📎 {att.name} — файл заблокирован антивирусом</p>
    );
  }
  if (att.scanStatus !== 'clean') {
    return <p className="mt-1 text-xs text-gray-500">📎 {label} — проверяется антивирусом…</p>;
  }
  return (
    <p className="mt-1 text-xs">
      <a
        href={`/api/manager/messengers/${dialogId}/attachment/${message.id}`}
        className="text-orange-700 underline hover:text-orange-800"
      >
        📎 {label}
      </a>
    </p>
  );
}

/**
 * Лента диалога (спека 2026-09-12 §5.2): входящие слева, исходящие справа;
 * у исходящих — кто написал и, если не дошло, честная пометка. Пустая лента
 * бывает только у диалога, начатого первым и ещё без сообщений — кнопки нет
 * намеренно: форма ответа стоит сразу под лентой (`У-74`).
 */
export function DialogThread({
  dialogId,
  messages,
  hiddenCount,
}: {
  dialogId: string;
  messages: DialogMessageView[];
  hiddenCount: number;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="💬"
        title="Сообщений пока нет"
        message="Напишите первым — ответ клиента появится здесь."
        className="p-6"
      />
    );
  }
  return (
    <div className="space-y-3">
      {hiddenCount > 0 && (
        <p className="text-center text-xs text-gray-400">
          Показаны последние {messages.length} сообщений, ещё {hiddenCount} старше.
        </p>
      )}
      <ol className="space-y-2" aria-label="Переписка">
        {messages.map((m) => {
          const isNote = m.direction === 'note';
          const out = m.direction === 'out';
          return (
            <li
              key={m.id}
              className={`flex ${isNote ? 'justify-center' : out ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                  isNote
                    ? 'w-full border border-dashed border-amber-300 bg-amber-50 text-gray-800'
                    : out
                      ? 'rounded-br-sm border border-orange-200 bg-orange-50 text-gray-800'
                      : 'rounded-bl-sm bg-gray-100 text-gray-800'
                }`}
              >
                {isNote && (
                  <p className="mb-0.5 text-[11px] font-medium text-amber-800">
                    Заметка · {m.authorName ?? 'Сотрудник'} · клиент не видит
                  </p>
                )}
                {out && !isNote && (
                  <p className="mb-0.5 text-[11px] font-medium text-orange-700">
                    {m.authorName ?? 'Сотрудник'}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <Attachment dialogId={dialogId} message={m} />
                <p className="mt-1 text-[11px] text-gray-400">
                  {fmtDateTime(m.createdAt)}
                  {out && !isNote && m.deliveryStatus === 'failed' && (
                    <span className="ml-2 text-red-600">не доставлено</span>
                  )}
                  {out && !isNote && m.deliveryStatus === 'pending' && (
                    <span className="ml-2 text-gray-500">ждёт проверки файла</span>
                  )}
                  {out && !isNote && m.deliveryStatus === 'sending' && (
                    <span className="ml-2 text-gray-500">отправляется…</span>
                  )}
                  {/*
                    `У-215`: обратная ссылка в очередь разбора. То же сообщение
                    лежит там строкой «Входящих в работу» — с привязкой к
                    организации, вложением и историей разбора. Без ссылки его
                    искали руками по имени отправителя.
                  */}
                  {m.inboundMessageId && (
                    <Link
                      href={`/manager/inbox?message=${encodeURIComponent(m.inboundMessageId)}`}
                      className="ml-2 text-[#EA580C] hover:underline"
                    >
                      Открыть во «Входящих»
                    </Link>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
