'use client';

import React, { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import type { DocumentNumbering } from '@/lib/services/admin/companyBranding';
import {
  setCompanyNumberingAction,
  setCompanyTaxSettingsAction,
} from '@/server-actions/admin/companyBranding';
import type { SettingsCabinet } from '@/lib/navigation/settings';

/**
 * Этап 5 (`У-138`) — блоки «Налоги» и «Нумерация документов» экрана
 * «Реквизиты исполнителя». Клиентская пара к server-actions
 * `companyBranding`: границу компании (админ — любая, руководитель — своя)
 * энфорсит сервис, здесь только формы.
 */

// Дельта поверх errorMessageRu: общий словарь для forbidden/not_found говорит
// про загрузку документов и заказы — здесь речь о настройках компании.
const ERROR_MAP: Record<string, string> = {
  forbidden: 'Нет прав изменять настройки этой компании.',
  not_found: 'Компания не найдена — обновите страницу.',
};

type ActionFailure = { error: string; messages?: string[] | undefined };

/** validation с messages — списком (сервис объясняет каждое поле отдельно). */
function renderFailure(res: ActionFailure): React.ReactNode {
  if (res.error === 'validation' && res.messages?.length) {
    return (
      <ul className="list-disc pl-4 space-y-0.5">
        {res.messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    );
  }
  return ERROR_MAP[res.error] ?? errorMessageRu(res.error, 'Не удалось сохранить настройки.');
}

/** Селект НДС: 'none' = «не облагается» (УСН), остальное — доля строкой. */
const VAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'не облагается (УСН)' },
  { value: '0', label: '0%' },
  { value: '0.05', label: '5%' },
  { value: '0.07', label: '7%' },
  { value: '0.1', label: '10%' },
  { value: '0.2', label: '20%' },
];

export function CompanyTaxForm({
  cabinet,
  companyId,
  defaultVatRate,
  pricesIncludeVat,
}: {
  /** Кабинет для гарда раздела в action (`requireSettingsSection`). */
  cabinet: SettingsCabinet;
  companyId: string;
  /** Ставка строкой фиксированной точности ('0.2000') или null = не облагается. */
  defaultVatRate: string | null;
  pricesIncludeVat: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  // Сервис хранит ставку строкой '0.2000' — к value селекта ('0.2') приводим
  // через Number, иначе предзаполнение не совпадёт (паттерн CatalogItemDialog).
  const vatDefault = defaultVatRate === null ? 'none' : String(Number(defaultVatRate));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await setCompanyTaxSettingsAction(cabinet, fd);
    setBusy(false);
    if (!res.ok) {
      setError(renderFailure(res));
      return;
    }
    toast.success('Налоговые настройки сохранены.');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid={`company-tax-form-${companyId}`}>
      <input type="hidden" name="companyId" value={companyId} />

      <Field htmlFor={`${uid}-vat`} label="Ставка НДС по умолчанию">
        <Select id={`${uid}-vat`} name="defaultVatRate" defaultValue={vatDefault} disabled={busy}>
          {VAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          name="pricesIncludeVat"
          defaultChecked={pricesIncludeVat}
          disabled={busy}
          className="accent-[#F97316] h-4 w-4"
        />
        цены включают НДС
      </label>

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

const PREFIX_FIELDS = [
  { name: 'prefixInvoice', key: 'invoice', label: 'Счёт' },
  { name: 'prefixAct', key: 'act', label: 'Акт' },
  { name: 'prefixContract', key: 'contract', label: 'Договор' },
  { name: 'prefixSupplementary', key: 'supplementary', label: 'Доп. соглашение' },
] as const;

export function CompanyNumberingForm({
  cabinet,
  companyId,
  numbering,
}: {
  cabinet: SettingsCabinet;
  companyId: string;
  /** null = шаблон ещё не настраивали (или сохранённый JSON не разобрался). */
  numbering: DocumentNumbering | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await setCompanyNumberingAction(cabinet, fd);
    setBusy(false);
    if (!res.ok) {
      setError(renderFailure(res));
      return;
    }
    toast.success('Шаблон нумерации сохранён.');
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-testid={`company-numbering-form-${companyId}`}
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PREFIX_FIELDS.map((f) => (
          <Field key={f.name} htmlFor={`${uid}-${f.name}`} label={f.label}>
            <Input
              id={`${uid}-${f.name}`}
              name={f.name}
              maxLength={12}
              disabled={busy}
              defaultValue={numbering?.prefixes[f.key] ?? ''}
            />
          </Field>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          name="resetYearly"
          defaultChecked={numbering?.resetYearly ?? false}
          disabled={busy}
          className="accent-[#F97316] h-4 w-4"
        />
        обнулять счётчик каждый год
      </label>

      <p className="text-xs text-gray-400">
        Префикс — до 12 символов: буквы, цифры, дефис. Шаблон применяется при выпуске
        документов.
      </p>

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
