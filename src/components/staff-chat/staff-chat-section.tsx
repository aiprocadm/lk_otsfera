'use client';
import React, { useRef, useState } from 'react';
import { useClientResource } from '@/hooks/useClientResource';
import { useStaffChatPolling, type StaffPolledRow } from '@/hooks/useStaffChatPolling';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { clientLog } from '@/lib/logging/client';
import {
  StaffConversationList,
  type StaffConversationRowVM,
  type StaffColleagueVM,
} from './staff-conversation-list';
import { StaffThreadView, type StaffThreadMessageVM } from './staff-thread-view';
import { StaffComposer, type StaffComposerAttachment } from './staff-composer';

function selectConversationRows(raw: unknown): StaffConversationRowVM[] {
  return (raw as { rows?: StaffConversationRowVM[] }).rows ?? [];
}

function selectColleagueRows(raw: unknown): StaffColleagueVM[] {
  return (raw as { rows?: StaffColleagueVM[] }).rows ?? [];
}

/**
 * 'use client' glue for the staff-chat domain (M4 spec 2026-07-17). Composes
 * the presentational list/thread/composer pieces and owns all network I/O —
 * mirrors OrderThreadInbox's role but as a standalone component (staff-chat
 * and order-comment chat are separate domains, CLAUDE.md §5).
 */
export function StaffChatSection({ currentUserId }: { currentUserId: string }) {
  const { data: conversations, refetch: refetchConversations } = useClientResource<
    StaffConversationRowVM[]
  >('/api/staff-chat/conversations', { intervalMs: 15_000, select: selectConversationRows });
  // One-shot load (no intervalMs) — the colleague roster changes rarely.
  const { data: colleaguesRaw } = useClientResource<StaffColleagueVM[]>(
    '/api/staff-chat/colleagues',
    {
      select: selectColleagueRows,
    }
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  // Ref-twin of activeId for async guards (same ref-technique as the polling
  // hooks): set synchronously in handleSelect BEFORE the first await, so an
  // in-flight loadMessages can check at response time whether it still belongs
  // to the active conversation — reading `activeId` inside the async closure
  // would see the stale value it captured at call time.
  const activeIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<StaffThreadMessageVM[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const rows = conversations ?? [];
  // The picker/mention list must never offer the current user as a target.
  const colleagues = (colleaguesRaw ?? []).filter((c) => c.id !== currentUserId);

  const latestCreatedAt = messages.length > 0 ? messages[messages.length - 1].createdAt : null;

  function appendNew(newRows: StaffPolledRow[], forConversationId: string) {
    // A poll fired for conversation A can resolve AFTER the user switched to B
    // (cleanup clears the interval, not an in-flight fetch) — drop the stale
    // batch instead of appending it into the wrong thread / marking B read.
    if (forConversationId !== activeId) return;
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const fresh = newRows.filter((r) => !existingIds.has(r.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
    void markRead(forConversationId);
  }

  useStaffChatPolling(activeId, latestCreatedAt, appendNew);

  async function loadMessages(conversationId: string) {
    setLoadingMessages(true);
    let next: StaffThreadMessageVM[] = [];
    try {
      const res = await fetch(
        `/api/staff-chat/messages?conversationId=${encodeURIComponent(conversationId)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { rows: StaffThreadMessageVM[] };
        next = data.rows;
      } else {
        clientLog.warn('[staff-chat-section] fetch messages failed', res.status);
      }
    } catch (err) {
      clientLog.warn('[staff-chat-section] fetch messages error', err);
    }
    // Stale-response guard (twin of the poll-batch tag check in appendNew): a
    // slow response for conversation A landing after the user switched to B
    // must not render A's rows (or clear/flip loading) under B — those states
    // belong to the active conversation's own in-flight load.
    if (activeIdRef.current !== conversationId) return;
    setMessages(next);
    setLoadingMessages(false);
  }

  async function markRead(conversationId: string) {
    try {
      const res = await fetch('/api/staff-chat/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
      if (res.ok) void refetchConversations();
    } catch (err) {
      clientLog.warn('[staff-chat-section] markRead error', err);
    }
  }

  async function handleSelect(conversationId: string) {
    activeIdRef.current = conversationId; // sync BEFORE the first await — see ref declaration
    setActiveId(conversationId);
    await loadMessages(conversationId);
    void markRead(conversationId);
  }

  async function handleSend(body: string, attachment: StaffComposerAttachment | null) {
    // StaffComposer only mounts (and can call onSend) once activeId is set, and
    // nothing in this component ever resets activeId back to null afterwards —
    // this guard is defensive-only and structurally unreachable via the UI.
    /* v8 ignore next -- defensive: composer that calls onSend cannot be mounted while activeId is null */
    if (!activeId) return;
    try {
      const res = await fetch('/api/staff-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeId,
          body,
          ...(attachment
            ? {
                attachmentPath: attachment.path,
                attachmentName: attachment.name,
                attachmentMime: attachment.mime,
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(errorMessageRu(data?.error ?? '', 'Не удалось отправить сообщение.'));
        return;
      }
      await loadMessages(activeId);
      void refetchConversations();
    } catch (err) {
      clientLog.warn('[staff-chat-section] send error', err);
      toast.error(errorMessageRu('network'));
    }
  }

  async function handleToggleReaction(messageId: string, emoji: string) {
    try {
      const res = await fetch('/api/staff-chat/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, emoji }),
      });
      if (res.ok && activeId) {
        await loadMessages(activeId);
      } else if (!res.ok) {
        clientLog.warn('[staff-chat-section] reaction failed', res.status);
      }
    } catch (err) {
      clientLog.warn('[staff-chat-section] reaction error', err);
    }
  }

  async function handleNewDm(targetUserId: string) {
    try {
      const res = await fetch('/api/staff-chat/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        toast.error(errorMessageRu(data?.error ?? '', 'Не удалось открыть диалог.'));
        return;
      }
      refetchConversations();
      await handleSelect(data.conversationId as string);
    } catch (err) {
      clientLog.warn('[staff-chat-section] new dm error', err);
      toast.error(errorMessageRu('network'));
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid #E5E7EB',
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        minHeight: '480px',
      }}
    >
      <div
        style={{
          width: '280px',
          flexShrink: 0,
          borderRight: '1px solid #E5E7EB',
          overflowY: 'auto',
        }}
      >
        <StaffConversationList
          rows={rows}
          activeId={activeId}
          onSelect={(id) => void handleSelect(id)}
          onNewDm={(id) => void handleNewDm(id)}
          colleagues={colleagues}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {activeId === null ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
              fontSize: '14px',
            }}
          >
            Выберите беседу
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loadingMessages ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#9CA3AF',
                    fontSize: '14px',
                  }}
                >
                  Загрузка…
                </div>
              ) : (
                <StaffThreadView
                  messages={messages}
                  currentUserId={currentUserId}
                  onToggleReaction={(id, emoji) => void handleToggleReaction(id, emoji)}
                />
              )}
            </div>
            <StaffComposer
              conversationId={activeId}
              colleagues={colleagues}
              onSend={(body, attachment) => void handleSend(body, attachment)}
            />
          </>
        )}
      </div>
    </div>
  );
}
