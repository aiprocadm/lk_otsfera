'use client';
import React, { useState } from 'react';

export type StaffConversationRowVM = {
  id: string;
  kind: 'dm' | 'general';
  title: string;
  companyName: string | null;
  lastMessageAt: string;
  unread: boolean;
};

export type StaffColleagueVM = { id: string; name: string };

type Props = {
  rows: StaffConversationRowVM[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewDm: (targetUserId: string) => void;
  colleagues: StaffColleagueVM[];
};

/**
 * Presentational conversation list for the staff-chat domain — sibling to
 * OrderThreadInbox's left panel, but a standalone component (staff-chat and
 * order-comment chat are separate domains per CLAUDE.md §5 sibling-pattern).
 * Ordering: general channel(s) first, then DMs sorted by lastMessageAt desc.
 */
export function StaffConversationList({ rows, activeId, onSelect, onNewDm, colleagues }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const generals = rows.filter((r) => r.kind === 'general');
  const dms = rows
    .filter((r) => r.kind === 'dm')
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  const ordered = [...generals, ...dms];

  function handlePick(targetUserId: string) {
    setPickerOpen(false);
    onNewDm(targetUserId);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{ padding: '10px 12px', borderBottom: '1px solid #E5E7EB', position: 'relative' }}
      >
        <button
          onClick={() => setPickerOpen((v) => !v)}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid #FED7AA',
            backgroundColor: '#FFF7ED',
            color: '#C2410C',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Новое сообщение
        </button>
        {pickerOpen && (
          <ul
            style={{
              listStyle: 'none',
              margin: '4px 0 0',
              padding: 0,
              position: 'absolute',
              left: '12px',
              right: '12px',
              zIndex: 10,
              backgroundColor: '#ffffff',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              maxHeight: '220px',
              overflowY: 'auto',
            }}
          >
            {colleagues.length === 0 ? (
              <li style={{ padding: '10px 12px', fontSize: '13px', color: '#9CA3AF' }}>
                Нет доступных коллег
              </li>
            ) : (
              colleagues.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handlePick(c.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: '#111111',
                    }}
                  >
                    {c.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {ordered.length === 0 ? (
        <div
          style={{ padding: '24px 16px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}
        >
          Нет бесед
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1 }}>
          {ordered.map((row) => {
            const isActive = row.id === activeId;
            return (
              <li key={row.id}>
                <button
                  onClick={() => onSelect(row.id)}
                  data-active={isActive ? 'true' : 'false'}
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
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {row.unread && (
                      <span
                        data-unread="true"
                        aria-label="Непрочитано"
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#F97316',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: row.unread ? 600 : 400,
                        color: '#111111',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.title}
                    </span>
                  </div>
                  {row.kind === 'general' && row.companyName && (
                    <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{row.companyName}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
