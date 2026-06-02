'use client';
import React from 'react';

export type ChatMessageVM = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  attachmentPath?: string | null;
  createdAt: string | Date;
};

function formatTime(createdAt: string | Date): string {
  try {
    const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ru-RU');
  } catch {
    return '';
  }
}

export function ChatThreadView({
  messages,
  currentUserId
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
        padding: '16px'
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
              alignItems: isMine ? 'flex-end' : 'flex-start'
            }}
          >
            {!isMine && (
              <span
                style={{
                  fontSize: '12px',
                  color: '#6B7280',
                  marginBottom: '4px',
                  fontWeight: 500
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
                wordBreak: 'break-word'
              }}
            >
              <p style={{ margin: 0 }}>{msg.body}</p>
              {msg.attachmentPath && (
                <a
                  href={msg.attachmentPath}
                  style={{
                    display: 'inline-block',
                    marginTop: '6px',
                    fontSize: '12px',
                    color: isMine ? 'rgba(255,255,255,0.85)' : '#F97316',
                    textDecoration: 'underline'
                  }}
                >
                  📎 вложение
                </a>
              )}
            </div>
            <span
              style={{
                fontSize: '11px',
                color: '#9CA3AF',
                marginTop: '4px'
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
