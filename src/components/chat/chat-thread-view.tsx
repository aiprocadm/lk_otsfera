'use client';
import React from 'react';
import { fmtDateTime } from '@/lib/format';

export type ChatMessageVM = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  /** Ready-to-render download URL (e.g. a signed URL or download route).
   *  Consumers MUST pass a signed/route URL per CLAUDE.md §10 — never a raw storage path. */
  attachmentUrl?: string | null | undefined;
  /** none|pending|clean|infected|error — не-clean прячет ссылку за бейджем
   *  (иначе она выглядела бы рабочей и падала 409/410 — молчаливый дефект §15). */
  scanStatus?: string | undefined;
  createdAt: string | Date;
};

/**
 * Вложение под текстом пузыря. Sibling к staff-chat AttachmentLine — общий
 * компонент не заводим осознанно (§4 CLAUDE.md, staff-чат — отдельный домен).
 */
function AttachmentLine({ msg, isMine }: { msg: ChatMessageVM; isMine: boolean }) {
  if (!msg.attachmentUrl) return null;
  if (msg.scanStatus === 'infected') {
    return (
      <span
        style={{
          display: 'inline-block',
          marginTop: '6px',
          fontSize: '12px',
          color: isMine ? 'rgba(255,255,255,0.85)' : '#DC2626',
        }}
      >
        ⛔ файл заражён
      </span>
    );
  }
  // Не-clean (pending/error/none-с-вложением) — файл ещё не проверен антивирусом.
  // Отсутствующий scanStatus (старый потребитель VM) трактуем как clean.
  if (msg.scanStatus !== undefined && msg.scanStatus !== 'clean') {
    return (
      <span
        style={{
          display: 'inline-block',
          marginTop: '6px',
          fontSize: '12px',
          color: isMine ? 'rgba(255,255,255,0.85)' : '#9CA3AF',
        }}
      >
        ⏳ файл проверяется
      </span>
    );
  }
  return (
    <a
      href={msg.attachmentUrl}
      style={{
        display: 'inline-block',
        marginTop: '6px',
        fontSize: '12px',
        color: isMine ? 'rgba(255,255,255,0.85)' : '#F97316',
        textDecoration: 'underline',
      }}
    >
      📎 вложение
    </a>
  );
}

function formatTime(createdAt: string | Date): string {
  try {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return fmtDateTime(d);
  } catch {
    return '';
  }
}

export function ChatThreadView({
  messages,
  currentUserId,
}: {
  messages: ChatMessageVM[];
  currentUserId: string;
}) {
  if (messages.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#6B7280', fontSize: '14px' }}>Пока нет сообщений</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
      }}
    >
      {messages.map((msg) => {
        const isMine = msg.authorId === currentUserId;
        return (
          <div
            key={msg.id}
            data-mine={isMine ? 'true' : 'false'}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMine ? 'flex-end' : 'flex-start',
            }}
          >
            {!isMine && (
              <span
                style={{
                  fontSize: '12px',
                  color: '#6B7280',
                  marginBottom: '4px',
                  fontWeight: 500,
                }}
              >
                {msg.authorName}
              </span>
            )}
            <div
              style={{
                maxWidth: '70%',
                padding: '10px 14px',
                borderRadius: '12px',
                backgroundColor: isMine ? '#F97316' : '#F3F4F6',
                color: isMine ? '#ffffff' : '#111111',
                fontSize: '14px',
                lineHeight: '1.5',
                wordBreak: 'break-word',
              }}
            >
              <p style={{ margin: 0 }}>{msg.body}</p>
              <AttachmentLine msg={msg} isMine={isMine} />
            </div>
            <span
              style={{
                fontSize: '11px',
                color: '#9CA3AF',
                marginTop: '4px',
              }}
            >
              {formatTime(msg.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
