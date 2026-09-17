'use client';

import React, { useState } from 'react';
import { toast } from '@/lib/ui/toast';
import { buttonClass } from '@/lib/ui/buttonClass';

/**
 * «Скачать» у материала для партнёров (`У-237`): подписанная ссылка на 10
 * минут; право и аудит «кто скачал» — на сервере.
 */
export function PartnerMaterialDownloadButton({ materialId }: { materialId: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner/materials/${materialId}/download`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { downloadUrl?: string };
      if (!res.ok || !data.downloadUrl) {
        toast.error('Не удалось получить ссылку на файл, попробуйте ещё раз');
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
      className={buttonClass({ variant: 'primary', size: 'sm' })}
      data-testid={`material-download-${materialId}`}
    >
      Скачать
    </button>
  );
}
