'use client';

import React, { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  CATALOG_UNIT_LABELS,
  VAT_RATES,
  type CatalogItemRow,
} from '@/lib/services/admin/catalogItems';
import {
  createCatalogItemAction,
  setCatalogItemActiveAction,
  updateCatalogItemAction,
} from '@/server-actions/admin/catalogItems';

/**
 * Этап 5 (`У-136`) — диалог создания/правки позиции каталога и кнопка
 * деактивации/возврата. Клиентская пара к серверному `PriceListScreen`:
 * доступ (admin | leader своей компании) энфорсит сервис, здесь только форма.
 */

// Дельта поверх errorMessageRu: коды каталога и формулировки под этот экран
// (общий словарь для forbidden/not_found говорит про загрузку и заказы).
const ERROR_MAP: Record<string, string> = {
  duplicate_code: 'Такой артикул уже есть в каталоге этой компании — укажите другой.',
  forbidden: 'Нет прав изменять каталог этой компании.',
  not_found: 'Услуга не найдена — обновите страницу.',
};

function resolveError(code: string, fallback: string): string {
  return ERROR_MAP[code] ?? errorMessageRu(code, fallback);
}

/** Селект НДС: 'none' = «не облагается» (УСН), остальное — доля строкой. */
const VAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'не облагается' },
  // 0.07 * 100 в двоичной арифметике = 7.000…01 — округляем до целого процента.
  ...VAT_RATES.map((r) => ({ value: String(r), label: `${Math.round(r * 100)}%` })),
];

export function CatalogItemDialog({
  cabinet,
  companyId,
  directions,
  item,
}: {
  /** Кабинет для гарда раздела в action (`requireSettingsSection`). */
  cabinet: 'admin' | 'leader';
  /** Компания, в чей каталог пишем (для создания; при правке сервис берёт свою). */
  companyId: string;
  directions: Array<{ id: string; name: string }>;
  /** Есть item — диалог правит существующую позицию, нет — создаёт новую. */
  item?: CatalogItemRow;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const isEdit = item !== undefined;

  // Сервис хранит ставку строкой фиксированной точности ('0.2000') — к value
  // селекта ('0.2') приводим через Number, иначе предзаполнение не совпадёт.
  const vatDefault = item ? (item.vatRate === null ? 'none' : String(Number(item.vatRate))) : 'none';

  function close() {
    setOpen(false);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    const res = isEdit
      ? await updateCatalogItemAction(cabinet, fd)
      : await createCatalogItemAction(cabinet, fd);
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'validation' && res.messages?.length) {
        // Сервис объясняет каждое поле отдельно — показываем списком, а не
        // безликим «проверьте форму».
        setError(
          <ul className="list-disc pl-4 space-y-0.5">
            {res.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        );
      } else {
        setError(resolveError(res.error, 'Не удалось сохранить услугу.'));
      }
      return;
    }
    // После создания чистим форму: диалог остаётся смонтированным, и при
    // повторном открытии старые значения провоцировали бы дубли.
    if (!isEdit) form.reset();
    setOpen(false);
    setError(null);
    toast.success(isEdit ? 'Услуга обновлена.' : 'Услуга добавлена в каталог.');
    router.refresh();
  }

  return (
    <>
      {isEdit ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Изменить
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>Добавить услугу</Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={isEdit ? 'Изменить услугу' : 'Новая услуга'}
        size="lg"
        busy={busy}
        error={error}
      >
        <form onSubmit={onSubmit} className="space-y-3">
          {isEdit ? (
            <input type="hidden" name="id" value={item.id} />
          ) : (
            <input type="hidden" name="companyId" value={companyId} />
          )}

          <Field htmlFor={`${uid}-name`} label="Название">
            <Input
              id={`${uid}-name`}
              name="name"
              required
              maxLength={300}
              defaultValue={item?.name ?? ''}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              htmlFor={`${uid}-code`}
              label="Артикул"
              hint="Код позиции, уникален внутри компании"
            >
              <Input
                id={`${uid}-code`}
                name="code"
                required
                maxLength={64}
                defaultValue={item?.code ?? ''}
              />
            </Field>
            <Field htmlFor={`${uid}-unit`} label="Единица">
              <Select id={`${uid}-unit`} name="unit" defaultValue={item?.unit ?? 'person'}>
                {Object.entries(CATALOG_UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor={`${uid}-price`} label="Цена, ₽">
              <Input
                id={`${uid}-price`}
                name="price"
                required
                inputMode="decimal"
                defaultValue={item?.price ?? ''}
              />
            </Field>
            <Field htmlFor={`${uid}-vat`} label="Ставка НДС">
              <Select id={`${uid}-vat`} name="vatRate" defaultValue={vatDefault}>
                {VAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              name="vatIncluded"
              defaultChecked={item ? item.vatIncluded : true}
              className="accent-[#F97316] h-4 w-4"
            />
            цена включает НДС
          </label>

          <Field htmlFor={`${uid}-direction`} label="Направление">
            <Select
              id={`${uid}-direction`}
              name="directionId"
              defaultValue={item?.directionId ?? ''}
            >
              <option value="">— не связано —</option>
              {/* Позиция может ссылаться на направление, которое потом
                  деактивировали: в списке активных его нет, и без этой опции
                  браузер молча выбрал бы «не связано» — правка одной цены
                  теряла бы связь (а по ней работает «Собрать строки из
                  позиций», У-139). */}
              {item?.directionId && !directions.some((d) => d.id === item.directionId) && (
                <option value={item.directionId}>
                  {(item.directionName ?? 'направление')} (неактивно)
                </option>
              )}
              {directions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field htmlFor={`${uid}-description`} label="Описание">
            <Textarea
              id={`${uid}-description`}
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={item?.description ?? ''}
            />
          </Field>

          <Field
            htmlFor={`${uid}-sortOrder`}
            label="Порядок"
            hint="Чем меньше число, тем выше позиция в списке"
          >
            <Input
              id={`${uid}-sortOrder`}
              name="sortOrder"
              type="number"
              min={0}
              max={100000}
              step={1}
              defaultValue={item?.sortOrder ?? 0}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * Деактивация/возврат позиции. Использованную услугу не удаляют (на неё
 * ссылаются строки заказов) — только выключают. Подтверждение — кнопкой с
 * двойным состоянием: первый клик показывает «Точно деактивировать?», второй
 * выполняет (window.confirm в проекте не для новых экранов, вложенный Dialog
 * поверх таблицы — лишний).
 */
export function CatalogItemActiveButton({
  cabinet,
  item,
}: {
  cabinet: 'admin' | 'leader';
  item: CatalogItemRow;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(active: boolean) {
    setBusy(true);
    const fd = new FormData();
    fd.set('id', item.id);
    fd.set('active', active ? '1' : '0');
    const res = await setCatalogItemActiveAction(cabinet, fd);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      toast.error(resolveError(res.error, 'Не удалось изменить статус услуги.'));
      return;
    }
    toast.success(
      active
        ? 'Услуга возвращена в каталог.'
        : 'Услуга деактивирована — в новые заказы она не попадёт.'
    );
    router.refresh();
  }

  if (!item.isActive) {
    return (
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => submit(true)}>
        Активировать
      </Button>
    );
  }
  if (!confirming) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
        Деактивировать
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="danger" disabled={busy} onClick={() => submit(false)}>
        Точно деактивировать?
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
        Отмена
      </Button>
    </span>
  );
}
