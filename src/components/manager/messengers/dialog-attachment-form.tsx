'use client';
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

/**
 * «Прикрепить файл» в диалоге (`У-204`).
 *
 * Это форма на API-роуте, а не действие формы: на действиях стоит общий предел
 * тела 25 МБ, и файл больше него отбрасывается ещё до сервера — форма молчала
 * бы, обещая куда больший размер (CLAUDE.md §11).
 *
 * Файл уходит клиенту не сразу: сначала антивирус. В ленте сообщение появится
 * с подписью «проверяется», и это честно — обещать «отправлено» до проверки
 * нельзя.
 */
const ERROR_LABEL: Record<string, string> = {
  forbidden: 'Нет доступа к этому диалогу.',
  not_found: 'Диалог не найден.',
  too_large: 'Файл слишком большой для этого канала.',
  invalid_mime: 'Такой формат файла отправить нельзя.',
  channel_no_attachments: 'В этом канале можно отправлять только текст — файл не уйдёт.',
  storage: 'Хранилище недоступно, попробуйте ещё раз.',
  bad_request: 'Выберите файл.',
};

export function DialogAttachmentForm({
  dialogId,
  limitMb,
}: {
  dialogId: string;
  /** Предел канала; по умолчанию — общий предел загрузки. */
  limitMb?: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const max = limitMb ?? DEFAULT_MAX_FILE_SIZE_MB;

  const { formAction, pending, errorText } = useFetchSubmit<{ messageId: string }>({
    url: `/api/manager/messengers/${dialogId}/attachment`,
    body: () => {
      const fd = new FormData();
      const file = inputRef.current?.files?.[0];
      if (file) fd.set('file', file);
      return fd;
    },
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Файл принят — уйдёт клиенту после проверки антивирусом');
      // Сброс обязателен: иначе повторное нажатие отправит тот же файл второй раз.
      formRef.current?.reset();
      setFileName('');
    },
  });

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        name="file"
        required
        disabled={pending}
        aria-label="Файл для клиента"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
        className="text-xs text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-2 file:py-1 file:text-xs"
      />
      <Button type="submit" variant="secondary" loading={pending} disabled={pending || !fileName}>
        Прикрепить
      </Button>
      <span className="text-xs text-gray-500">до {max} МБ</span>
      {errorText && (
        <p role="alert" className="w-full text-xs text-red-600">
          {errorText}
        </p>
      )}
    </form>
  );
}
