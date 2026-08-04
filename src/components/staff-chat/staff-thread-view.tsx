'use client';
import React, { useEffect, useRef } from 'react';
import { fmtDate, fmtDateTime } from '@/lib/format';

type StaffReactionVM = { emoji: string; count: number; mine: boolean };

export type StaffThreadMessageVM = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  scanStatus: string;
  createdAt: string;
  reactions: StaffReactionVM[];
};

/** Fixed reaction emoji set (product decision — not user-configurable). */
const REACTION_EMOJI = ['👍', '✅', '🔥', '😄', '❓'] as const;

type Props = {
  messages: StaffThreadMessageVM[];
  currentUserId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
};

/** Returns a ru-RU day label, or null when createdAt doesn't parse (defensive). */
function dayKey(createdAt: string): string | null {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return fmtDate(d);
}

function AttachmentLine({ msg }: { msg: StaffThreadMessageVM }) {
  if (!msg.hasAttachment) return null;
  if (msg.scanStatus === 'pending') {
    return <span style={{ fontSize: '12px', color: '#9CA3AF' }}>⏳ проверяется</span>;
  }
  if (msg.scanStatus === 'infected') {
    return <span style={{ fontSize: '12px', color: '#DC2626' }}>⛔ файл заражён</span>;
  }
  return (
    <a
      href={`/api/staff-chat/attachment?messageId=${encodeURIComponent(msg.id)}`}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-block',
        marginTop: '4px',
        fontSize: '12px',
        color: '#F97316',
        textDecoration: 'underline',
      }}
    >
      📎 {msg.attachmentName ?? 'вложение'}
    </a>
  );
}

/**
 * Presentational staff-chat message list — sibling to ChatThreadView, but a
 * standalone component (staff-chat is a separate domain per CLAUDE.md §5).
 * Own messages align right, others left; date separators between days;
 * fixed-emoji reaction chips under each bubble.
 */
export function StaffThreadView({ messages, currentUserId, onToggleReaction }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bottomRef.current;
    // jsdom (unit tests) doesn't implement scrollIntoView — guard defensively
    // rather than crash; real browsers always have it.
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#6B7280', fontSize: '14px' }}>Сообщений пока нет</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px' }}>
      {messages.map((msg, index) => {
        const isMine = msg.authorId === currentUserId;
        const day = dayKey(msg.createdAt);
        // Pure lookback (no mutable render-scoped variable, React Compiler-safe):
        // the previous message's day, or null before the first message.
        const prevMsg = messages[index - 1];
        const prevDay = prevMsg ? dayKey(prevMsg.createdAt) : null;
        const showSeparator = day !== null && day !== prevDay;
        return (
          <React.Fragment key={msg.id}>
            {showSeparator && (
              <div
                style={{ textAlign: 'center', fontSize: '11px', color: '#9CA3AF', margin: '4px 0' }}
              >
                {day}
              </div>
            )}
            <div
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
                <AttachmentLine msg={msg} />
              </div>
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                {REACTION_EMOJI.map((emoji) => {
                  const found = msg.reactions.find((r) => r.emoji === emoji);
                  const count = found?.count ?? 0;
                  const mine = found?.mine ?? false;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onToggleReaction(msg.id, emoji)}
                      data-mine={mine ? 'true' : 'false'}
                      aria-pressed={mine}
                      aria-label={`Реакция ${emoji}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        border: mine ? '1px solid #F97316' : '1px solid #E5E7EB',
                        backgroundColor: mine ? '#FFF7ED' : '#ffffff',
                        color: mine ? '#C2410C' : '#374151',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      <span>{emoji}</span>
                      {count > 0 && <span>{count}</span>}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>
                {fmtDateTime(msg.createdAt)}
              </span>
            </div>
          </React.Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
