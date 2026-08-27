'use client';

import React, { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { BRANDING_MAX_BYTES, BRANDING_MAX_FILE_MB } from '@/lib/config/branding';
import type { BrandingSlotView } from '@/lib/services/admin/companyBranding';
import { deleteCompanyBrandingAction } from '@/server-actions/admin/companyBranding';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Этап 5 (`У-138`) — блок «Оформление документов»: логотип · подпись · печать.
 *
 * Загрузка — fetch на файловый API-роут `/api/company/branding`, НЕ server
 * action (§11 CLAUDE.md — bodySizeLimit). Предпросмотр даётся только clean-
 * файлу (presigned URL выдаёт сервис); pending/infected показывают статус
 * проверки словами. Удаление — server action (файла в теле нет).
 */

/** Все три слота рисуем всегда — пропс `slots` несёт только существующие. */
const SLOTS: Array<{ slot: BrandingSlotView['slot']; label: string }> = [
  { slot: 'logo', label: 'Логотип' },
  { slot: 'signature', label: 'Подпись' },
  { slot: 'stamp', label: 'Печать' },
];

const TOO_LARGE_MESSAGE = `Файл больше ${BRANDING_MAX_FILE_MB} МБ — уменьшите изображение.`;

// Дельта поверх errorMessageRu под этот экран (общие формулировки словаря —
// про документы заказов).
const ERROR_MAP: Record<string, string> = {
  too_large: TOO_LARGE_MESSAGE,
  forbidden: 'Нет прав изменять оформление этой компании.',
  not_found: 'Компания не найдена — обновите страницу.',
  storage: 'Хранилище файлов недоступно — попробуйте позже.',
  invalid_request: 'Файл не выбран или запрос неполный.',
};

/** Код/messages из ответа роута → русская строка (Result-контракт §3). */
async function extractError(res: Response): Promise<string> {
  let body: { error?: unknown; messages?: unknown } = {};
  try {
    body = (await res.json()) as { error?: unknown; messages?: unknown };
  } catch {
    /* тело не JSON / пустое — останется http_<status> */
  }
  const code = typeof body.error === 'string' && body.error ? body.error : `http_${res.status}`;
  if (code === 'validation' && Array.isArray(body.messages) && body.messages.length > 0) {
    return (body.messages as string[]).join(' ');
  }
  return ERROR_MAP[code] ?? errorMessageRu(code, 'Не удалось загрузить файл.');
}

export function CompanyBrandingSlots({
  cabinet,
  companyId,
  slots,
}: {
  /** Кабинет для гарда раздела в delete-action (`requireSettingsSection`). */
  cabinet: SettingsCabinet;
  companyId: string;
  /** Только существующие файлы; пустые слоты рисуются по словарю. */
  slots: BrandingSlotView[];
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {SLOTS.map(({ slot, label }) => (
        <BrandingSlotCard
          key={slot}
          cabinet={cabinet}
          companyId={companyId}
          slot={slot}
          label={label}
          view={slots.find((s) => s.slot === slot)}
        />
      ))}
    </div>
  );
}

function BrandingSlotCard({
  cabinet,
  companyId,
  slot,
  label,
  view,
}: {
  cabinet: SettingsCabinet;
  companyId: string;
  slot: BrandingSlotView['slot'];
  label: string;
  view: BrandingSlotView | undefined;
}) {
  const router = useRouter();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Файл не выбран.');
      return;
    }
    // Клиентская проверка ДО отправки: гонять мегабайты ради заведомого 413
    // незачем; сервер всё равно проверит сам.
    if (file.size > BRANDING_MAX_BYTES) {
      setError(TOO_LARGE_MESSAGE);
      return;
    }
    const fd = new FormData();
    fd.set('companyId', companyId);
    fd.set('slot', slot);
    fd.set('file', file);
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch('/api/company/branding', { method: 'POST', body: fd });
    } catch {
      setBusy(false);
      setError(errorMessageRu('network', 'Сетевая ошибка.'));
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setError(await extractError(res));
      return;
    }
    if (fileRef.current) fileRef.current.value = '';
    toast.success(`«${label}» загружен — файл проверяется антивирусом.`);
    router.refresh();
  }

  async function onDelete() {
    const fd = new FormData();
    fd.set('companyId', companyId);
    fd.set('slot', slot);
    setBusy(true);
    setError(null);
    const res = await deleteCompanyBrandingAction(cabinet, fd);
    setBusy(false);
    if (!res.ok) {
      setError(ERROR_MAP[res.error] ?? errorMessageRu(res.error, 'Не удалось удалить файл.'));
      return;
    }
    toast.success(`«${label}» удалён.`);
    router.refresh();
  }

  return (
    <div
      data-testid={`branding-slot-${slot}`}
      className="border border-gray-200 rounded-lg p-4 space-y-2"
    >
      <h3 className="text-sm font-semibold text-[#111111]">{label}</h3>

      {!view ? (
        <p className="text-xs text-gray-400">Файл не загружен.</p>
      ) : view.scanStatus === 'clean' && view.previewUrl ? (
        // Presigned S3-URL живёт 10 минут и меняет хост; next/image потребовал
        // бы remotePatterns и закешировал бы протухающую ссылку.
        // eslint-disable-next-line @next/next/no-img-element -- см. комментарий выше
        <img
          src={view.previewUrl}
          alt={`${label} — предпросмотр`}
          className="max-h-24 max-w-full border border-gray-100 rounded"
        />
      ) : view.scanStatus === 'infected' ? (
        <p
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1"
        >
          Файл не прошёл проверку — загрузите другой.
        </p>
      ) : view.scanStatus === 'error' ? (
        // Терминальный статус: ждать нечего, надо перезалить. Ревью PR-3:
        // раньше он попадал в ветку «проверяется» и висел там вечно.
        <p
          role="alert"
          className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1"
        >
          Проверить файл не удалось — загрузите его ещё раз.
        </p>
      ) : (
        <p
          role="status"
          className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1"
        >
          Файл проверяется антивирусом — предпросмотр появится после проверки.
        </p>
      )}

      <form onSubmit={onUpload} className="space-y-2">
        <input
          id={`${uid}-file`}
          ref={fileRef}
          type="file"
          accept="image/png,image/svg+xml"
          aria-label={`Файл — ${label}`}
          disabled={busy}
          className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] file:cursor-pointer disabled:opacity-50"
        />
        <p className="text-xs text-gray-400">PNG или SVG, до {BRANDING_MAX_FILE_MB} МБ.</p>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={busy}>
            Загрузить
          </Button>
          {view && (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onDelete}>
              Удалить
            </Button>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
