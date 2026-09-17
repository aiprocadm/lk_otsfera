'use client';

import React, { useId, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@/lib/config/upload';
import {
  PARTNER_MATERIAL_CATEGORIES,
  PARTNER_MATERIAL_CATEGORY_LABELS,
} from '@/lib/services/partnerMaterials/shared';

/**
 * Форма нового материала для партнёров (`У-237`). Файл уходит fetch-ом на
 * файловый API-роут `/api/partner-materials`, НЕ server action (§11 CLAUDE.md).
 * Ровно одно из двух: файл или ссылка — переключатель не даёт заполнить оба.
 */
const ERROR_MAP: Record<string, string> = {
  too_large: `Файл больше ${DEFAULT_MAX_FILE_SIZE_MB} МБ.`,
  invalid_mime: 'Такой формат не поддерживается: PDF, Word, Excel, PowerPoint, JPG или PNG.',
  forbidden: 'Нет прав публиковать материалы этой компании.',
  not_found: 'Компания не найдена — обновите страницу.',
  storage: 'Хранилище файлов недоступно — попробуйте позже.',
  invalid_request: 'Заполните название и выберите категорию.',
};

async function extractError(res: Response): Promise<string> {
  let body: { error?: unknown; messages?: unknown } = {};
  try {
    body = (await res.json()) as { error?: unknown; messages?: unknown };
  } catch {
    /* тело не JSON — останется http_<status> */
  }
  const code = typeof body.error === 'string' && body.error ? body.error : `http_${res.status}`;
  if (code === 'validation' && Array.isArray(body.messages) && body.messages.length > 0) {
    return (body.messages as string[]).join(' ');
  }
  return ERROR_MAP[code] ?? errorMessageRu(code, 'Не удалось сохранить материал.');
}

export function PartnerMaterialUploadForm({
  companyId,
  onDone,
  onCancel,
}: {
  companyId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('companyId', companyId);
    if (mode === 'link') fd.delete('file');
    else fd.set('externalUrl', '');
    setBusy(true);
    try {
      const res = await fetch('/api/partner-materials', { method: 'POST', body: fd });
      if (!res.ok) {
        toast.error(await extractError(res));
        return;
      }
      toast.success('Материал сохранён — он появится у партнёров после публикации.');
      form.reset();
      onDone();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
      data-testid="partner-material-form"
    >
      <Field htmlFor={`${uid}-title`} label="Название">
        <Input id={`${uid}-title`} name="title" required maxLength={200} />
      </Field>
      <Field htmlFor={`${uid}-category`} label="Категория">
        <Select id={`${uid}-category`} name="category" defaultValue="other">
          {PARTNER_MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PARTNER_MATERIAL_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        htmlFor={`${uid}-description`}
        label="Описание"
        hint="Одна-две строки: что внутри и кому пригодится."
      >
        <Textarea id={`${uid}-description`} name="description" rows={2} maxLength={2000} />
      </Field>
      <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Что публикуем">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="mode"
            checked={mode === 'file'}
            onChange={() => setMode('file')}
          />
          Файл
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="mode"
            checked={mode === 'link'}
            onChange={() => setMode('link')}
          />
          Ссылка
        </label>
      </div>
      {mode === 'file' ? (
        <Field
          htmlFor={`${uid}-file`}
          label="Файл"
          hint={`PDF, Word, Excel, PowerPoint, JPG или PNG до ${DEFAULT_MAX_FILE_SIZE_MB} МБ. Партнёры увидят файл после проверки антивирусом.`}
        >
          <input id={`${uid}-file`} name="file" type="file" required className="text-sm" />
        </Field>
      ) : (
        <Field htmlFor={`${uid}-url`} label="Ссылка" hint="Адрес страницы или файла в интернете.">
          <Input id={`${uid}-url`} name="externalUrl" type="url" required placeholder="https://…" />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy}>
          Сохранить черновик
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
