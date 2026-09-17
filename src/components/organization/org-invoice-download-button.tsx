'use client';

import React, { useState } from 'react';
import { toast } from '@/lib/ui/toast';
import { buttonClass } from '@/lib/ui/buttonClass';

/**
 * «Скачать» у счёта в «Финансах» заказчика (`У-235`) — тем же роутом, что и
 * раздел «Документы»: подписанная ссылка на 10 минут, аудит на сервере.
 * Отдельная маленькая кнопка, а не панель документов: в списке счетов
 * нет ни загрузки, ни фильтров по типу.
 */
export function OrgInvoiceDownloadButton({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/organization/documents/${documentId}/download`, {
        method: 'POST',
      });
      const data = (await res.json().catch(() => ({}))) as { downloadUrl?: string; error?: string };
      if (!res.ok || !data.downloadUrl) {
        toast.error(
          res.status === 410
            ? 'Файл не прошёл проверку антивирусом — скачивание закрыто'
            : 'Не удалось получить ссылку на файл, попробуйте ещё раз'
        );
        return;
      }
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      className={buttonClass({ variant: 'secondary', size: 'sm' })}
      data-testid={`invoice-download-${documentId}`}
    >
      Скачать
    </button>
  );
}
