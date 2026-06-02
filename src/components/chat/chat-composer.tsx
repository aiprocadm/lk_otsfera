'use client';
import React, { useRef, useState } from 'react';

export function ChatComposer({
  onSend,
  disabled,
  onAttachFile
}: {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
  onAttachFile?: (file: File) => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void onSend(trimmed);
    setText('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && onAttachFile) {
      void onAttachFile(file);
      // reset so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const canSubmit = !disabled && text.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 16px',
        borderTop: '1px solid #E5E7EB',
        backgroundColor: '#ffffff'
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Напишите сообщение…"
        disabled={disabled}
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
          boxSizing: 'border-box'
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {onAttachFile && (
          <>
            <label
              htmlFor="chat-file-input"
              style={{
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #D1D5DB',
                fontSize: '16px',
                lineHeight: 1,
                userSelect: 'none',
                color: '#374151'
              }}
              title="Прикрепить файл"
            >
              📎
            </label>
            <input
              id="chat-file-input"
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              disabled={disabled}
              style={{ display: 'none' }}
            />
          </>
        )}
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
            transition: 'background-color 0.15s'
          }}
        >
          Отправить
        </button>
      </div>
    </form>
  );
}
