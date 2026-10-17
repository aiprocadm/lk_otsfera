'use client';
import React, { useState } from 'react';
import { StaffNewGroupForm } from './staff-new-group-form';
import { staffRoleLabel, type StaffColleagueVM } from './staff-colleague';

export type StaffConversationRowVM = {
  id: string;
  kind: 'dm' | 'general' | 'group';
  title: string;
  companyName: string | null;
  lastMessageAt: string;
  unread: boolean;
};

export type { StaffColleagueVM };

type Props = {
  rows: StaffConversationRowVM[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewDm: (targetUserId: string) => void;
  /** `У-315`: свой чат — название и участники; `true` — создан. */
  onNewGroup: (title: string, participantIds: string[]) => Promise<boolean>;
  colleagues: StaffColleagueVM[];
};

/**
 * Presentational conversation list for the staff-chat domain — sibling to
 * OrderThreadInbox's left panel, but a standalone component (staff-chat and
 * order-comment chat are separate domains per CLAUDE.md §5 sibling-pattern).
 * Ordering: general channel(s) first, then own chats and DMs by lastMessageAt desc.
 */
export function StaffConversationList({
  rows,
  activeId,
  onSelect,
  onNewDm,
  onNewGroup,
  colleagues,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const found = q ? colleagues.filter((c) => c.name.toLowerCase().includes(q)) : colleagues;

  const generals = rows.filter((r) => r.kind === 'general');
  const dms = rows
    .filter((r) => r.kind !== 'general')
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
          onClick={() => {
            setGroupOpen(false);
            setPickerOpen((v) => !v);
          }}
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
        {/* `У-315`: свой чат команды — вне чатов заказов. */}
        <button
          onClick={() => {
            setPickerOpen(false);
            setGroupOpen((v) => !v);
          }}
          style={{
            width: '100%',
            marginTop: '6px',
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid #E5E7EB',
            backgroundColor: '#ffffff',
            color: '#374151',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          + Новый чат
        </button>
        {groupOpen && (
          <StaffNewGroupForm
            colleagues={colleagues}
            onCancel={() => setGroupOpen(false)}
            onCreate={async (title, ids) => {
              const ok = await onNewGroup(title, ids);
              if (ok) setGroupOpen(false);
              return ok;
            }}
          />
        )}
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
            <li style={{ padding: '6px 8px' }}>
              <input
                aria-label="Найти коллегу"
                placeholder="Найти коллегу"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  fontSize: '13px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '6px',
                }}
              />
            </li>
            {found.length === 0 ? (
              <li style={{ padding: '10px 12px', fontSize: '13px', color: '#9CA3AF' }}>
                {colleagues.length === 0 ? 'Нет доступных коллег' : 'Никого не нашли'}
              </li>
            ) : (
              found.map((c) => (
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
                    {c.role && (
                      <span style={{ color: '#6B7280' }}> · {staffRoleLabel(c.role)}</span>
                    )}
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
