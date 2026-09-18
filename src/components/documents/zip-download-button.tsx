'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { zipSkippedSummaryRu, type ZipSkipped } from '@/lib/documents/zipSummary';

/**
 * «Скачать выбранные (ZIP)» (`У-252`, этап 8) — одна кнопка на все шесть
 * списков документов.
 *
 * Качаем через `fetch`, а не обычной ссылкой, ровно по одной причине: у ответа
 * есть что сказать помимо файла. Часть выбранных бумаг в архив не попадает —
 * чужие, в карантине, ещё на антивирусной проверке, — и человек обязан узнать
 * об этом сразу, а не пересчитывать файлы в архиве. Ссылка такой ответ
 * проглотила бы молча.
 *
 * Права здесь не считаются: сервис проверяет КАЖДЫЙ документ тем же гейтом,
 * что и одиночное скачивание (§4, `Р-Э8-3`).
 */
export function ZipDownloadButton({
  ids,
  size = 'sm',
}: {
  ids: readonly string[];
  size?: 'sm' | 'md';
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/zip?ids=${encodeURIComponent(ids.join(','))}`);
      if (!res.ok) {
        // Тело отказа несёт готовую русскую строку с числами — показываем её,
        // а не общее «Произошла ошибка»: человеку надо знать, что поправить.
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? 'Не удалось собрать архив. Попробуйте ещё раз.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Документы.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const count = res.headers.get('x-documents-count') ?? '0';
      const skipped = parseSkipped(res.headers.get('x-documents-skipped'));
      const tail = skipped ? ` Не вошло — ${zipSkippedSummaryRu(skipped)}.` : '';
      toast.success(`Архив собран: ${count} документов.${tail}`);
    } catch {
      toast.error('Сетевая ошибка. Проверьте соединение и попробуйте снова.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size={size}
      variant="secondary"
      onClick={() => void download()}
      disabled={ids.length === 0 || busy}
    >
      {busy ? 'Собираю архив…' : 'Скачать выбранные (ZIP)'}
    </Button>
  );
}

/**
 * Значения заголовков ходят в латинице, поэтому сервер присылает числа, а
 * фразу собирает экран — той же функцией, что и сервер в теле отказа.
 * Битый заголовок — не повод ронять успешное скачивание: просто молчим.
 */
function parseSkipped(raw: string | null): ZipSkipped | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ZipSkipped;
    const total = parsed.noAccess + parsed.pending + parsed.infected + parsed.unavailable;
    return Number.isFinite(total) && total > 0 ? parsed : null;
  } catch {
    return null;
  }
}
