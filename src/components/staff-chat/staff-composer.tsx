'use client';
import React, { useId, useRef, useState } from 'react';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { clientLog } from '@/lib/logging/client';
import type { StaffColleagueVM } from './staff-conversation-list';

export type StaffComposerAttachment = { path: string; name: string; mime: string };

type UploadResponse = { ok: true; attachmentPath: string } | { ok: false; error?: string };

type Props = {
  conversationId: string;
  colleagues: StaffColleagueVM[];
  onSend: (body: string, attachment: StaffComposerAttachment | null) => void | Promise<void>;
};

/** Returns the @-token under the caret, or null when the caret isn't inside one. */
function mentionToken(value: string, caret: number): string | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const token = upto.slice(at + 1);
  if (/\s/.test(token)) return null;
  return token;
}

/**
 * Staff-chat composer — sibling to ChatComposer, but a standalone component
 * (staff-chat is a separate domain, CLAUDE.md §5). Adds @-mention autocomplete
 * (no library — simple controlled token match) and a staged-attachment chip:
 * staff-chat uploads synchronously via POST /api/staff-chat/attachment before
 * the message itself is sent, unlike the order-comment chat's attach-then-send
 * flow which defers upload plumbing to the parent.
 */
export function StaffComposer({ conversationId, colleagues, onSend }: Props) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<StaffComposerAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const filteredColleagues =
    mentionQuery === null
      ? []
      : colleagues.filter((c) => c.name.toLowerCase().startsWith(mentionQuery.toLowerCase()));
  const showMentions = mentionQuery !== null && filteredColleagues.length > 0;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    // HTMLTextAreaElement.selectionStart is non-nullable (unlike the generic
    // HTMLInputElement) — no fallback needed.
    setMentionQuery(mentionToken(value, e.target.selectionStart));
  }

  function insertMention(name: string) {
    const el = textareaRef.current;
    // Dropdown items only render once the textarea itself has mounted, so the
    // ref is always attached by the time a click reaches here.
    /* v8 ignore next -- defensive: ref cannot be null when a dropdown item is clickable */
    if (!el) return;
    const caret = el.selectionStart;
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) return;
    const before = text.slice(0, at);
    const after = text.slice(caret);
    const insertion = `@${name} `;
    const next = before + insertion + after;
    setText(next);
    setMentionQuery(null);
    const pos = before.length + insertion.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || uploading) return;
    void onSend(trimmed, attachment);
    setText('');
    setAttachment(null);
    setMentionQuery(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('conversationId', conversationId);
      const res = await fetch('/api/staff-chat/attachment', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as UploadResponse | null;
      if (!res.ok || !data || !data.ok) {
        const code = data && !data.ok ? data.error : undefined;
        toast.error(errorMessageRu(code ?? '', 'Не удалось загрузить файл.'));
        return;
      }
      setAttachment({ path: data.attachmentPath, name: file.name, mime: file.type });
    } catch (err) {
      clientLog.warn('[staff-composer] attachment upload error', err);
      toast.error(errorMessageRu('network'));
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = !uploading && text.trim().length > 0;

  return (
    <div
      style={{ position: 'relative', borderTop: '1px solid #E5E7EB', backgroundColor: '#ffffff' }}
    >
      {showMentions && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            position: 'absolute',
            bottom: '100%',
            left: '16px',
            right: '16px',
            zIndex: 10,
            backgroundColor: '#ffffff',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
            maxHeight: '160px',
            overflowY: 'auto',
          }}
        >
          {filteredColleagues.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => insertMention(c.name)}
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
                @{c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachment && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            backgroundColor: '#FFF7ED',
            borderBottom: '1px solid #FED7AA',
            fontSize: '13px',
            color: '#C2410C',
          }}
        >
          <span>📎 {attachment.name}</span>
          <button
            onClick={() => setAttachment(null)}
            aria-label="Убрать вложение"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#9CA3AF',
              fontSize: '16px',
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px' }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Напишите сообщение… (@ для упоминания)"
          aria-label="Сообщение"
          rows={3}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #D1D5DB',
            fontSize: '14px',
            lineHeight: '1.5',
            color: '#111111',
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label
            htmlFor={fileInputId}
            title="Прикрепить файл"
            style={{
              cursor: uploading ? 'default' : 'pointer',
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #D1D5DB',
              fontSize: '16px',
              lineHeight: 1,
              userSelect: 'none',
              color: '#374151',
              opacity: uploading ? 0.5 : 1,
            }}
          >
            📎
          </label>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            onChange={(e) => void handleFileChange(e)}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginLeft: 'auto',
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: canSubmit ? '#F97316' : '#D1D5DB',
              color: canSubmit ? '#ffffff' : '#9CA3AF',
              fontSize: '14px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            Отправить
          </button>
        </div>
      </form>
    </div>
  );
}
