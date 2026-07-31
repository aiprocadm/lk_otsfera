'use client';

import React, { useState } from 'react';
import { toast } from '@/lib/ui/toast';

/**
 * «Скачать удостоверение» в деталке заявки (этап 2 PR-2, §5 спеки): presigned
 * URL через существующий generic-роут документов (сервис отдаёт documentId
 * только когда право на документ уже проверено).
 */
export function CertificateDownloadButton({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/download`, { method: 'POST' });
      if (!res.ok) {
        toast.error(
          res.status === 410
            ? 'Файл в карантине: не прошёл антивирусную проверку.'
            : 'Не удалось получить ссылку для скачивания.'
        );
        return;
      }
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="text-xs text-[#F97316] hover:underline disabled:text-gray-400"
    >
      {busy ? 'Готовим ссылку…' : 'Скачать удостоверение'}
    </button>
  );
}
