'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogUnit } from '@prisma/client';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { CATALOG_UNIT_LABELS, VAT_RATES } from '@/lib/services/admin/catalogItems';
import type { OrderLineRow, OrderLinesView } from '@/lib/services/orders/orderLines';
import type { OrderCatalogOption } from '@/lib/services/orders/linesPanel';
import {
  addOrderLineAction,
  buildLinesFromItemsAction,
  recalcOrderTotalAction,
  removeOrderLineAction,
  setOrderTotalManuallyAction,
  updateOrderLineAction,
  type OrderLineActionResult,
} from '@/server-actions/orders/lines';

/**
 * Этап 5 (`У-139`, `У-140`) — блок «Состав и стоимость» карточки заказа.
 *
 * Компонент **презентационный**: строки, итоги и каталог приходят пропсами
 * (страница собирает их `getOrderLinesPanel`), в базу он не ходит. Все правки
 * идут через server-actions, права и запреты решает сервис — здесь только вид
 * и подсказки человеку.
 *
 * Цена в строке — **снимок** (`Р-13`): выбор позиции каталога лишь
 * ПРЕДЗАПОЛНЯЕТ поля, дальше они правятся руками и от каталога не зависят.
 */

const ERROR_LABELS: Record<string, string> = {
  order_from_1c: 'Заказ ведётся в 1С — строки и сумма приходят из обмена, здесь их не меняют.',
  forbidden: 'Нет прав менять состав этого заказа.',
  not_found: 'Строка не найдена — обновите страницу.',
};

const MONEY = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

/** Деньги здесь с копейками: в составе заказа они значимы (см. lib/format.ts). */
function money(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${MONEY.format(n)} ₽`;
}

function amountOf(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return NUMBER.format(n);
}

function vatLabel(line: { vatRate: string | null; vatIncluded: boolean }): string {
  if (line.vatRate === null) return 'без НДС';
  const percent = Math.round(Number(line.vatRate) * 100);
  return `${percent}% ${line.vatIncluded ? 'в сумме' : 'сверху'}`;
}

/** Селект НДС: 'none' = «не облагается» (УСН), остальное — доля строкой. */
const VAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'не облагается' },
  // 0.07 * 100 в двоичной арифметике = 7.000…01 — округляем до целого процента.
  ...VAT_RATES.map((r) => ({ value: String(r), label: `${Math.round(r * 100)}%` })),
];

type Draft = {
  catalogItemId: string;
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string;
  /** 'none' либо доля строкой — как в селекте. */
  vatRate: string;
  vatIncluded: boolean;
  sortOrder: string;
};

function emptyDraft(sortOrder: number): Draft {
  return {
    catalogItemId: '',
    title: '',
    quantity: '1',
    unit: 'person',
    unitPrice: '',
    discountPercent: '',
    vatRate: 'none',
    vatIncluded: true,
    sortOrder: String(sortOrder),
  };
}

function draftFromLine(line: OrderLineRow): Draft {
  return {
    catalogItemId: line.catalogItemId ?? '',
    title: line.title,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent ?? '',
    // Сервис хранит ставку с 4 знаками ('0.2000'), селект — '0.2'.
    vatRate: line.vatRate === null ? 'none' : String(Number(line.vatRate)),
    vatIncluded: line.vatIncluded,
    sortOrder: String(line.sortOrder),
  };
}

type Failure = Extract<OrderLineActionResult, { ok: false }>;

function failureText(res: Failure): string {
  if (res.messages && res.messages.length > 0) return res.messages.join(' · ');
  return resolveErrorText(res.error, ERROR_LABELS);
}

function failureNode(res: Failure): React.ReactNode {
  if (res.messages && res.messages.length > 0) {
    // Сервис объясняет каждое поле отдельно — показываем списком, а не
    // безликим «проверьте форму».
    return (
      <ul className="list-disc pl-4 space-y-0.5">
        {res.messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    );
  }
  return resolveErrorText(res.error, ERROR_LABELS);
}

type OrderLinesSectionProps = {
  orderId: string;
  view: OrderLinesView;
  catalog: OrderCatalogOption[];
  /** Кабинет вообще разрешает правку. Итоговое решение всё равно за сервисом. */
  canEdit: boolean;
};

export function OrderLinesSection({ orderId, view, catalog, canEdit }: OrderLinesSectionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** null — диалог закрыт; { line: null } — новая строка. */
  const [editing, setEditing] = useState<{ line: OrderLineRow | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(0));
  const [dialogError, setDialogError] = useState<React.ReactNode>(null);
  const [search, setSearch] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [manualTotal, setManualTotal] = useState(view.totalAmount);

  const editable = canEdit && !view.readOnly;

  const query = search.trim().toLowerCase();
  const matches = query
    ? catalog.filter(
        (c) =>
          c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)
      )
    : catalog;

  function openAdd() {
    setDraft(emptyDraft(view.lines.length));
    setSearch('');
    setDialogError(null);
    setEditing({ line: null });
  }

  function openEdit(line: OrderLineRow) {
    setDraft(draftFromLine(line));
    setSearch('');
    setDialogError(null);
    setEditing({ line });
  }

  function closeDialog() {
    setEditing(null);
    setDialogError(null);
  }

  function prefill(item: OrderCatalogOption) {
    setDraft((d) => ({
      ...d,
      catalogItemId: item.id,
      title: item.name,
      unit: item.unit,
      unitPrice: item.price,
      vatRate: item.vatRate === null ? 'none' : String(Number(item.vatRate)),
      vatIncluded: item.vatIncluded,
    }));
  }

  async function run(fn: () => Promise<OrderLineActionResult>, okText: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(failureText(res));
      return;
    }
    toast.success(okText);
    router.refresh();
  }

  function formData(): FormData {
    const fd = new FormData();
    // Заказ нужен экшену правки: сервис отвечает только «ок», а освежать надо
    // конкретную карточку.
    fd.set('orderId', orderId);
    fd.set('catalogItemId', draft.catalogItemId);
    fd.set('title', draft.title);
    fd.set('quantity', draft.quantity);
    fd.set('unit', draft.unit);
    fd.set('unitPrice', draft.unitPrice);
    fd.set('discountPercent', draft.discountPercent);
    fd.set('vatRate', draft.vatRate);
    if (draft.vatIncluded) fd.set('vatIncluded', 'on');
    fd.set('sortOrder', draft.sortOrder);
    return fd;
  }

  async function onSubmitLine(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = editing?.line ?? null;
    setBusy(true);
    setDialogError(null);
    const res = target
      ? await updateOrderLineAction(target.id, formData())
      : await addOrderLineAction(orderId, formData());
    setBusy(false);
    if (!res.ok) {
      setDialogError(failureNode(res));
      return;
    }
    setEditing(null);
    toast.success(target ? 'Строка обновлена.' : 'Строка добавлена.');
    router.refresh();
  }

  async function onBuildFromItems() {
    setBusy(true);
    const res = await buildLinesFromItemsAction(orderId);
    setBusy(false);
    if (!res.ok) {
      toast.error(failureText(res));
      return;
    }
    toast.success(
      res.withoutPrice.length > 0
        ? `Добавлено строк: ${res.created}. Без цены в каталоге: ${res.withoutPrice.join(', ')} — проверьте суммы.`
        : `Добавлено строк: ${res.created}.`
    );
    router.refresh();
  }

  function onManualTotal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('totalAmount', manualTotal);
    void run(
      () => setOrderTotalManuallyAction(orderId, fd),
      'Сумма заказа задана вручную — строки её больше не меняют.'
    );
  }

  const addButtons = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy} onClick={openAdd}>
        Добавить строку
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onBuildFromItems()}>
        Собрать строки из позиций
      </Button>
    </div>
  );

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#111111]">Состав и стоимость</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Из чего складывается сумма заказа: услуги, количество, цена и НДС.
          </p>
        </div>
        {editable && view.lines.length > 0 && addButtons}
      </div>

      {view.readOnly && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          Заказ ведётся в 1С: строки и сумма приходят из обмена. Здесь они только для чтения.
        </p>
      )}

      {view.lines.length === 0 ? (
        <EmptyState
          icon="🧾"
          message={
            view.readOnly
              ? 'Строк нет — их пришлёт обмен с 1С.'
              : editable
                ? 'Добавьте строки вручную или соберите их из позиций заказа — сумма посчитается сама.'
                : 'Строк пока нет. Их добавляют сотрудники центрального офиса.'
          }
          action={editable ? addButtons : undefined}
        />
      ) : (
        <TableShell overflow="x-auto" className="shadow-none">
          <THead>
            <Th className="w-10">№</Th>
            <Th>Наименование</Th>
            <Th className="text-right">Кол-во</Th>
            <Th>Ед.</Th>
            <Th className="text-right">Цена</Th>
            <Th className="text-right">Скидка</Th>
            <Th>НДС</Th>
            <Th className="text-right">Сумма</Th>
            {editable && <Th className="text-right">Действия</Th>}
          </THead>
          <tbody>
            {view.lines.map((line, index) => (
              <Tr key={line.id}>
                <Td className="text-gray-400">{index + 1}</Td>
                <Td className="text-[#111111]">{line.title}</Td>
                <Td className="text-right whitespace-nowrap">{amountOf(line.quantity)}</Td>
                <Td className="whitespace-nowrap">{CATALOG_UNIT_LABELS[line.unit]}</Td>
                <Td className="text-right whitespace-nowrap">{money(line.unitPrice)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {line.discountPercent === null ? '—' : `${amountOf(line.discountPercent)}%`}
                </Td>
                <Td className="whitespace-nowrap">{vatLabel(line)}</Td>
                <Td className="text-right font-medium whitespace-nowrap">{money(line.amount)}</Td>
                {editable && (
                  <Td className="text-right whitespace-nowrap">
                    {confirmId === line.id ? (
                      <span className="inline-flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirmId(null);
                            void run(
                              () => removeOrderLineAction(line.id, orderId),
                              'Строка удалена.'
                            );
                          }}
                        >
                          Точно удалить?
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmId(null)}
                        >
                          Отмена
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => openEdit(line)}
                        >
                          Изменить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmId(line.id)}
                        >
                          Удалить
                        </Button>
                      </span>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Total label="Без НДС" value={money(view.totals.net)} />
        <Total label="НДС" value={money(view.totals.vat)} />
        <Total label="С НДС" value={money(view.totals.gross)} strong />
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Сумма заказа</span>
          <span className="text-base font-bold text-[#111111]">{money(view.totalAmount)}</span>
          {view.totalAmountIsManual && <Badge tone="warning">сумма задана вручную</Badge>}
        </div>

        {view.totalAmountIsManual && (
          <p className="text-xs text-gray-500">
            Строки её больше не меняют. Вернуть расчёт по строкам — кнопкой ниже.
          </p>
        )}

        {editable && (
          <div className="flex flex-wrap items-end gap-3">
            <form onSubmit={onManualTotal} className="flex items-end gap-2">
              <Field htmlFor="order-total-manual" label="Задать сумму вручную">
                <Input
                  id="order-total-manual"
                  inputMode="decimal"
                  className="w-40"
                  value={manualTotal}
                  disabled={busy}
                  onChange={(e) => setManualTotal(e.target.value)}
                />
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                Задать вручную
              </Button>
            </form>
            {view.totalAmountIsManual && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => recalcOrderTotalAction(orderId),
                    'Сумма пересчитана по строкам.'
                  )
                }
              >
                Пересчитать по строкам
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={editing !== null}
        onClose={closeDialog}
        title={editing?.line ? 'Изменить строку' : 'Новая строка'}
        size="lg"
        busy={busy}
        error={dialogError}
      >
        <form onSubmit={onSubmitLine} className="space-y-3">
          {catalog.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <Field
                htmlFor="line-catalog-search"
                label="Выбрать из каталога"
                hint="Поиск по названию или артикулу. Выбор подставит цену, единицу и НДС — дальше правьте руками."
              >
                <Input
                  id="line-catalog-search"
                  value={search}
                  disabled={busy}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              {matches.length === 0 ? (
                <p className="text-xs text-gray-500">Ничего не нашлось — заполните строку вручную.</p>
              ) : (
                <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100">
                  {matches.slice(0, 20).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => prefill(item)}
                        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#FFF7ED] rounded"
                      >
                        <span className="text-[#111111]">{item.name}</span>
                        <span className="text-gray-400"> · {item.code}</span>
                        <span className="text-gray-500"> · {money(item.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Field htmlFor="line-title" label="Наименование">
            <Input
              id="line-title"
              required
              maxLength={300}
              value={draft.title}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field htmlFor="line-quantity" label="Количество">
              <Input
                id="line-quantity"
                required
                inputMode="decimal"
                value={draft.quantity}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              />
            </Field>
            <Field htmlFor="line-unit" label="Единица">
              <Select
                id="line-unit"
                value={draft.unit}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value as CatalogUnit }))}
              >
                {Object.entries(CATALOG_UNIT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="line-price" label="Цена, ₽">
              <Input
                id="line-price"
                required
                inputMode="decimal"
                value={draft.unitPrice}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, unitPrice: e.target.value }))}
              />
            </Field>
            <Field htmlFor="line-discount" label="Скидка, %" hint="Пусто — скидки нет">
              <Input
                id="line-discount"
                inputMode="decimal"
                value={draft.discountPercent}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, discountPercent: e.target.value }))}
              />
            </Field>
            <Field htmlFor="line-vat" label="Ставка НДС">
              <Select
                id="line-vat"
                value={draft.vatRate}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, vatRate: e.target.value }))}
              >
                {VAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="line-sort" label="Порядок">
              <Input
                id="line-sort"
                type="number"
                min={0}
                max={100000}
                step={1}
                value={draft.sortOrder}
                disabled={busy}
                onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={draft.vatIncluded}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, vatIncluded: e.target.checked }))}
              className="accent-[#F97316] h-4 w-4"
            />
            цена включает НДС
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={closeDialog}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {editing?.line ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={strong ? 'text-base font-bold mt-0.5' : 'text-sm font-medium mt-0.5'}>
        {value}
      </div>
    </div>
  );
}
