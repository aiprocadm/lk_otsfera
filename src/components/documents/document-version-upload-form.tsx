'use client';

import React, { useRef, useState } from 'react';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import { toast } from '@/lib/ui/toast';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';
import { Button } from '@/components/ui';

/**
 * «Загрузить новую версию» (`У-251`) — форма в карточке загруженного документа.
 *
 * Раньше заменить файл было нельзя: человек грузил второй документ рядом, и в
 * списке лежали две одинаковые бумаги без указания, какая действующая. Теперь
 * прежняя версия помечается заменённой, новая получает следующий номер, а
 * история остаётся видна.
 *
 * Куда отправлять — решает СТРАНИЦА своего кабинета (`url` + `fields`): у
 * каждого кабинета своя дверь загрузки со своими правилами, и компонент их не
 * выбирает. Он же не проверяет права: `canUploadVersion` посчитал сервер, и
 * сервис проверит всё заново (§4).
 *
 * Форма отправляется API-роутом, а не server action: у действий общий предел
 * тела 25 МБ, и файл крупнее молча пропадал бы, хотя подпись обещает 200 МБ
 * (CLAUDE.md §11).
 */
export function DocumentVersionUploadForm({
  url,
  fields,
  documentId,
  currentVersion,
}: {
  url: string;
  /** Поля формы кабинета: тип, получатель, контрагент, заказ. */
  fields: Record<string, string>;
  documentId: string;
  currentVersion: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { formAction, pending, errorText } = useFetchSubmit<{ documentId: string }>({
    url,
    body: () => {
      const fd = new FormData();
      const file = fileInputRef.current?.files?.[0];
      if (file) fd.set('file', file);
      for (const [key, value] of Object.entries(fields)) fd.set(key, value);
      fd.set('replacesDocumentId', documentId);
      return fd;
    },
    refresh: true,
    onSuccess: () => {
      toast.success(`Загружена версия ${currentVersion + 1}. Прежняя помечена как заменённая.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  // Пустой выбор и файл больше предела до сервера не доходят: незачем гнать
  // сотню мегабайт ради ответа «слишком большой».
  function guardedAction(formData: FormData) {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setLocalError('Файл не выбран.');
      return;
    }
    if (file.size > DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024) {
      setLocalError(`Файл больше предела в ${DEFAULT_MAX_FILE_SIZE_MB} МБ — выберите поменьше.`);
      return;
    }
    setLocalError(null);
    formAction(formData);
  }

  const error = localError ?? errorText;

  return (
    <section
      aria-labelledby="doc-new-version-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
    >
      <h2 id="doc-new-version-heading" className="text-sm font-semibold text-[#111111]">
        Новая версия документа
      </h2>
      <p className="text-sm text-gray-500">
        {`Файл заменит действующую версию ${currentVersion}. Прежняя останется в истории и уйдёт из списков.`}
      </p>
      <form action={guardedAction} className="flex flex-col gap-3">
        <label className="text-sm text-gray-700">
          <span className="block text-xs text-gray-500 mb-1">Файл</span>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            disabled={pending}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50"
          />
        </label>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Загружаю…' : 'Загрузить новую версию'}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <p className="text-xs text-gray-400">
          Допустимые форматы: PDF, JPG, PNG, DOCX, XLS, XLSX. Максимум {DEFAULT_MAX_FILE_SIZE_MB}{' '}
          МБ.
        </p>
      </form>
    </section>
  );
}
