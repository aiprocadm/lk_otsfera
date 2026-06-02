'use client';
import React, { useState } from 'react';
import type { ThreadSide } from '@prisma/client';
import { ChatThreadView, type ChatMessageVM } from '@/components/chat/chat-thread-view';
import { ChatComposer } from '@/components/chat/chat-composer';

type Thread = {
  id: string;
  orderId: string;
  side: ThreadSide;
  orderNumber: string | null;
  orderTitle: string;
  lastMessageAt: Date;
  unread: boolean;
};

type Props = {
  threads: Thread[];
  currentUserId: string;
};

export function PartnerMessagesInbox({ threads, currentUserId }: Props) {
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadUnread, setThreadUnread] = useState<Record<string, boolean>>(
    () => Object.fromEntries(threads.map((t) => [t.id, t.unread]))
  );

  async function selectThread(thread: Thread) {
    setSelected(thread);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages?threadId=${encodeURIComponent(thread.id)}`);
      if (res.ok) {
        const data = (await res.json()) as { rows: Array<{ id: string; authorId: string; authorName: string; body: string; createdAt: string }> };
        const vms: ChatMessageVM[] = data.rows.map((r) => ({
          id: r.id,
          authorId: r.authorId,
          authorName: r.authorName,
          body: r.body,
          attachmentUrl: undefined,
          createdAt: r.createdAt
        }));
        setMessages(vms);
      } else {
        console.warn('[partner-messages-inbox] fetch messages failed', res.status);
        setMessages([]);
      }
    } catch (err) {
      console.warn('[partner-messages-inbox] fetch messages error', err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }

    // Mark thread as read — fire-and-forget
    fetch('/api/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: thread.id })
    }).then((res) => {
      if (res.ok) setThreadUnread((prev) => ({ ...prev, [thread.id]: false }));
    }).catch((err) => {
      console.warn('[partner-messages-inbox] markRead error', err);
    });
  }

  async function handleSend(text: string) {
    if (!selected) return;
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: selected.orderId, body: text })
      });
      if (!res.ok) {
        console.warn('[partner-messages-inbox] send message failed', res.status);
        return;
      }
      // Refetch messages for the selected thread
      const fetchRes = await fetch(`/api/messages?threadId=${encodeURIComponent(selected.id)}`);
      if (fetchRes.ok) {
        const data = (await fetchRes.json()) as { rows: Array<{ id: string; authorId: string; authorName: string; body: string; createdAt: string }> };
        setMessages(
          data.rows.map((r) => ({
            id: r.id,
            authorId: r.authorId,
            authorName: r.authorName,
            body: r.body,
            attachmentUrl: undefined,
            createdAt: r.createdAt
          }))
        );
      }
    } catch (err) {
      console.warn('[partner-messages-inbox] handleSend error', err);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: '0',
        border: '1px solid #E5E7EB',
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        minHeight: '480px'
      }}
    >
      {/* Left panel — thread list */}
      <div
        style={{
          width: '280px',
          flexShrink: 0,
          borderRight: '1px solid #E5E7EB',
          overflowY: 'auto'
        }}
      >
        {threads.length === 0 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: '#6B7280',
              fontSize: '14px'
            }}
          >
            Нет переписок
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {threads.map((thread) => {
              const isActive = selected?.id === thread.id;
              const isUnread = threadUnread[thread.id] ?? thread.unread;
              return (
                <li key={thread.id}>
                  <button
                    onClick={() => void selectThread(thread)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 16px',
                      border: 'none',
                      borderBottom: '1px solid #F3F4F6',
                      backgroundColor: isActive ? '#FFF7ED' : '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isUnread && (
                        <span
                          data-unread="true"
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#F97316',
                            flexShrink: 0
                          }}
                          aria-label="Непрочитано"
                        />
                      )}
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: isUnread ? 600 : 400,
                          color: '#111111',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {thread.orderTitle}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {thread.orderNumber ?? '—'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right panel — thread view + composer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selected === null ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '14px'
            }}
          >
            Выберите переписку
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #E5E7EB',
                backgroundColor: '#F9FAFB'
              }}
            >
              <span style={{ fontSize: '13px', color: '#6B7280' }}>
                {selected.orderNumber ? `${selected.orderNumber} · ` : ''}
              </span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#111111' }}>
                {selected.orderTitle}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loadingMessages ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#9CA3AF', fontSize: '14px' }}>
                  Загрузка…
                </div>
              ) : (
                <ChatThreadView messages={messages} currentUserId={currentUserId} />
              )}
            </div>
            <ChatComposer onSend={handleSend} />
          </>
        )}
      </div>
    </div>
  );
}
