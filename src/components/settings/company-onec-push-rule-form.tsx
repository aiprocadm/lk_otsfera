'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentType, OneCDocumentPushMode } from '@prisma/client';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { setOneCDocumentPushRuleAction } from '@/server-actions/admin/oneCDocumentPushRule';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Этап 8 (`У-169`) — блок «Выгрузка документов в 1С» экрана «Реквизиты
 * исполнителя». Клиентская пара к action `oneCDocumentPushRule`: границу
 * компании (админ — любая, руководитель — своя) энфорсит сервис, здесь
 * только форма. Экран один у администратора и руководителя (правило зеркала).
 */

// Дельта поверх errorMessageRu: общий словарь для forbidden/not_found говорит
// про загрузку документов и заказы — здесь речь о настройках компании.
const ERROR_MAP: Record<string, string> = {
  forbidden: 'Нет прав изменять настройки этой компании.',
  not_found: 'Компания не найдена — обновите страницу.',
};

/** Три варианта правила — подписи из глоссария («Правило выгрузки»). */
const MODE_OPTIONS: ReadonlyArray<{
  value: OneCDocumentPushMode;
  label: string;
  hint: string;
}> = [
  {
    value: 'auto',
    label: 'автоматически при выпуске',
    hint: 'Документ уезжает в 1С сразу после выпуска — без участия сотрудника.',
  },
  {
    value: 'manual',
    label: 'только по кнопке',
    hint: 'Сотрудник нажимает «Выгрузить в 1С» в карточке документа.',
  },
  {
    value: 'never',
    label: 'никогда',
    hint: 'Документы этой компании в 1С не отправляются, кнопки нет.',
  },
];

/** Четыре типа, которые 1С принимает (`Р-14`: КП не выгружается). Подписи — из глоссария. */
const TYPE_OPTIONS: ReadonlyArray<{ value: DocumentType; label: string }> = [
  { value: 'invoice', label: 'Счёт' },
  { value: 'act', label: 'Акт' },
  { value: 'contract', label: 'Договор' },
  { value: 'extra_agreement', label: 'Доп. соглашение' },
];

export function CompanyOneCPushRuleForm({
  cabinet,
  companyId,
  mode,
  types,
}: {
  /** Кабинет для гарда раздела в action (`requireSettingsSection`). */
  cabinet: SettingsCabinet;
  companyId: string;
  mode: OneCDocumentPushMode;
  /** Какие типы уезжают при `auto` (и предлагаются по кнопке). */
  types: DocumentType[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await setOneCDocumentPushRuleAction(cabinet, fd);
    setBusy(false);
    if (!res.ok) {
      setError(ERROR_MAP[res.error] ?? errorMessageRu(res.error, 'Не удалось сохранить правило.'));
      return;
    }
    toast.success('Правило выгрузки в 1С сохранено.');
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-testid={`company-onec-push-rule-form-${companyId}`}
    >
      <input type="hidden" name="companyId" value={companyId} />

      <fieldset className="space-y-2">
        <legend className="text-sm text-gray-700">Когда выгружать</legend>
        {MODE_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2 text-sm text-gray-600">
            <input
              type="radio"
              name="mode"
              value={o.value}
              defaultChecked={mode === o.value}
              disabled={busy}
              className="mt-1 accent-[#F97316]"
            />
            <span>
              {o.label}
              <span className="block text-xs text-gray-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm text-gray-700">Какие документы</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((t) => (
            <label key={t.value} className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                name="types"
                value={t.value}
                defaultChecked={types.includes(t.value)}
                disabled={busy}
                className="accent-[#F97316] h-4 w-4"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Button type="submit" size="sm" loading={busy}>
          Сохранить
        </Button>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}
    </form>
  );
}
