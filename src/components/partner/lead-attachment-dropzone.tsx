'use client';
import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';

const ACCEPT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const ACCEPT_ATTR = ACCEPT_MIME.join(',') + ',.pdf,.jpg,.jpeg,.png,.docx,.xlsx';

type Props = {
  leadId: string;
  maxSizeMb?: number;
};

export function LeadAttachmentDropzone({ leadId, maxSizeMb = DEFAULT_MAX_FILE_SIZE_MB }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > maxSizeMb * 1024 * 1024) {
        setError(`Файл больше ${maxSizeMb} МБ`);
        return;
      }
      if (file.type && !ACCEPT_MIME.includes(file.type)) {
        setError('Поддерживаются PDF, JPEG, PNG, DOCX, XLSX');
        return;
      }
      const form = new FormData();
      form.append('file', file);
      setUploading(true);
      try {
        const res = await fetch(`/api/partner/leads/${leadId}/attachments`, {
          method: 'POST',
          body: form
        });
        if (!res.ok) {
          if (res.status === 413) setError(`Файл больше ${maxSizeMb} МБ`);
          else if (res.status === 415) setError('Не поддерживаемый формат');
          else if (res.status === 403) setError('Заявка не редактируется');
          else {
            const body = await res.json().catch(() => null);
            setError(body?.error ?? `Ошибка загрузки: ${res.status}`);
          }
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка сети');
      } finally {
        setUploading(false);
      }
    },
    [leadId, maxSizeMb, router]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) await upload(file);
    },
    [upload]
  );

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await upload(file);
      e.target.value = '';
    },
    [upload]
  );

  return (
    <div className='space-y-2'>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`cursor-pointer border-2 border-dashed rounded-xl px-5 py-6 text-center transition-colors ${
          dragOver
            ? 'border-[#F97316] bg-orange-50'
            : 'border-gray-300 hover:border-[#F97316] hover:bg-orange-50'
        } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type='file'
          accept={ACCEPT_ATTR}
          className='hidden'
          onChange={onPick}
          disabled={uploading}
        />
        <div className='text-sm text-[#111111] font-medium'>
          {uploading ? 'Загружаем…' : 'Перетащите файл или нажмите для выбора'}
        </div>
        <div className='text-xs text-gray-500 mt-1'>
          PDF, JPEG, PNG, DOCX, XLSX до {maxSizeMb} МБ
        </div>
      </div>
      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2'>
          {error}
        </div>
      )}
    </div>
  );
}
