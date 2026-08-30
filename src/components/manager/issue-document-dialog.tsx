'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogUnit } from '@prisma/client';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { CATALOG_UNIT_LABELS, VAT_RATES } from '@/lib/services/admin/catalogItems';
import { errorMessageRu } from '@/lib/errors/messages';
import { generateOrderDocumentAction } from '@/server-actions/documents/generate';
import type { MissingRequisite } from '@/lib/documents/requisites-check';
import type {
  IssueBaseDocument,
  IssueCatalogOption,
} from '@/lib/services/documents/generationPanel';

/**
 * Форма выпуска документа (`У-147`).
 *
 * Один диалог на все четыре типа: тип · контрагент · состав · дата · поля
 * своего типа · предпросмотр · выпуск. До этапа 6 документы выпускались
 * четырьмя кнопками «в один клик» — сотрудник не видел, что уйдёт клиенту, и
 * не мог поправить ни строку, ни дату.
 *
 * Компонент презентационно-интерактивный: суммы считает сервер (и показывает
 * их в предпросмотре), права и полнота реквизитов — тоже сервер. Считать
 * деньги здесь второй раз означало бы иметь две арифметики.
 */

export type IssueLine = {
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
};

export type IssueDocType = 'invoice' | 'act' | 'contract' | 'extra_agreement';

/**
 * Кому выпускаем (`У-145`): заказ или организация. Разные ветки, а не
 * «необязательный номер заказа»: форма без заказа не показывает акт, не
 * сверяет суммы и не предзаполняет состав — сделать это одним полем-«может
 * быть» значило бы прятать три разных правила за пустой строкой.
 */
export type IssueTargetRef =
  { kind: 'order'; orderId: string } | { kind: 'organization'; organizationId: string };

const DOC_LABEL: Record<IssueDocType, string> = {
  invoice: 'Счёт',
  act: 'Акт',
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
};

/** Что этот документ делает — одной строкой, без внутренних терминов. */
const DOC_HINT: Record<IssueDocType, string> = {
  invoice: 'Счёт на оплату: заказчик платит по нему в банке.',
  act: 'Акт: подтверждает, что услуги оказаны. Выпускается по счёту.',
  contract: 'Договор на оказание услуг.',
  extra_agreement: 'Доп. соглашение: меняет условия уже подписанного договора.',
};

/**
 * Новая строка состава. Ставка НДС берётся из умолчания компании (`У-138`):
 * пустое поле у плательщика НДС выглядит нормально, а печатается «НДС не
 * облагается» — то есть документ уходит клиенту без налога, и никто этого не
 * замечает. Ставку по-прежнему можно поменять в самой строке.
 */
function emptyLine(defaultVatRate: string | null): IssueLine {
  return {
    title: '',
    quantity: '1',
    unit: 'service',
    unitPrice: '0',
    discountPercent: null,
    vatRate: defaultVatRate,
    vatIncluded: true,
  };
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function IssueDocumentDialog({
  open,
  onClose,
  target,
  counterpartyName,
  orderLines,
  missingByType,
  baseDocuments,
  hasInvoice,
  hasContract,
  catalog = [],
  defaultSubject = '',
  defaultVatRate = null,
}: {
  open: boolean;
  onClose: () => void;
  target: IssueTargetRef;
  counterpartyName: string;
  /** Состав заказа для предзаполнения; без заказа — пусто. */
  orderLines: IssueLine[];
  missingByType: Record<IssueDocType, MissingRequisite[]>;
  baseDocuments: IssueBaseDocument[];
  hasInvoice: boolean;
  hasContract: boolean;
  /** `У-145`: каталог услуг компании — строку можно взять из него, а не набирать. */
  catalog?: IssueCatalogOption[];
  /** Предмет договора по умолчанию: без заказа его подсказывает сделка. */
  defaultSubject?: string;
  /** Ставка НДС компании-исполнителя для строк, набранных вручную (`У-138`). */
  defaultVatRate?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const withOrder = target.kind === 'order';
  const [docType, setDocType] = useState<IssueDocType>('invoice');
  // Строки приходят со своими ставками (состав заказа или предзаполнение) и
  // здесь не переписываются: `null` у строки заказа — это «не облагается», а
  // не «ставку забыли». Умолчание компании получают только НОВЫЕ строки.
  const [lines, setLines] = useState<IssueLine[]>(
    orderLines.length > 0 ? orderLines : [emptyLine(defaultVatRate)]
  );
  const [documentDate, setDocumentDate] = useState(today());
  const [subject, setSubject] = useState(defaultSubject);
  const [validUntil, setValidUntil] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [changeText, setChangeText] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [parentDocumentId, setParentDocumentId] = useState('');
  const [busy, setBusy] = useState<'preview' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ linesTotal: string; orderTotal: string } | null>(null);

  const missing = missingByType[docType] ?? [];
  // `У-145`: акт наследует номер счёта ЗАКАЗА — без заказа его не предлагаем.
  // Сервер запрещает то же самое отдельно (`act_requires_order`).
  const docTypes: IssueDocType[] = withOrder
    ? ['invoice', 'act', 'contract', 'extra_agreement']
    : ['invoice', 'contract', 'extra_agreement'];
  const needsInvoice = docType === 'act' && !hasInvoice;
  const needsContract = docType === 'extra_agreement' && !hasContract;
  const blocked = missing.length > 0 || needsInvoice || needsContract;
  const parentType = docType === 'act' ? 'invoice' : 'contract';
  const parentOptions = baseDocuments.filter((d) => d.type === parentType);

  /**
   * Пакет для сервера. Уезжают ТОЛЬКО те поля, которые форма показала для
   * выбранного типа: значения живут в состоянии диалога и при смене типа не
   * стираются, поэтому набранный для договора «Порядок оплаты» иначе уехал бы
   * в доп. соглашение — и напечатался бы в бумаге пунктом, которого человек
   * на экране уже не видел. Заодно он глушил бы текст, настроенный компанией
   * в шаблоне (`У-160`).
   */
  function payload(onAmountMismatch?: 'update_order' | 'keep_order') {
    const isContract = docType === 'contract';
    const isExtra = docType === 'extra_agreement';
    const isAct = docType === 'act';
    return JSON.stringify({
      ...(target.kind === 'order'
        ? { orderId: target.orderId }
        : { organizationId: target.organizationId }),
      docType,
      lines,
      documentDate,
      ...(onAmountMismatch ? { onAmountMismatch } : {}),
      ...(isContract && subject.trim() ? { subject: subject.trim() } : {}),
      ...(isContract && validUntil ? { validUntil } : {}),
      ...(isContract && paymentTerms.trim() ? { paymentTerms: paymentTerms.trim() } : {}),
      ...(isExtra && changeText.trim() ? { changeText: changeText.trim() } : {}),
      ...(isAct && periodFrom ? { periodFrom } : {}),
      ...(isAct && periodTo ? { periodTo } : {}),
      ...((isAct || isExtra) && parentDocumentId ? { parentDocumentId } : {}),
    });
  }

  async function preview() {
    setBusy('preview');
    setError(null);
    try {
      const res = await fetch('/api/manager/documents/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errorMessageRu(data.error ?? 'network'));
        return;
      }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setError(errorMessageRu('network'));
    } finally {
      setBusy(null);
    }
  }

  async function issue(onAmountMismatch?: 'update_order' | 'keep_order') {
    setBusy('issue');
    setError(null);
    const fd = new FormData();
    fd.set('payload', payload(onAmountMismatch));
    const res = await generateOrderDocumentAction(fd);
    setBusy(null);
    if (!res.ok) {
      if (res.error === 'amount_mismatch') {
        // `У-143`: не выбираем цифру за человека — показываем обе и спрашиваем.
        setMismatch({ linesTotal: res.linesTotal, orderTotal: res.orderTotal });
        return;
      }
      setError(errorMessageRu(res.error));
      return;
    }
    toast.success(`${DOC_LABEL[docType]} № ${res.number} выпущен.`);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setMismatch(null);
    onClose();
    startTransition(() => router.refresh());
  }

  function patchLine(index: number, patch: Partial<IssueLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /**
   * `У-145`: строка из каталога. Цена и ставка — **снимок** позиции на момент
   * подстановки: строку потом правят руками, и последующее изменение прайса
   * уже выпущенный документ не трогает.
   */
  function addFromCatalog(itemId: string) {
    const item = catalog.find((c) => c.id === itemId);
    // Пустое значение — это подпись «Из каталога…», а не позиция.
    if (!item) return;
    setLines((prev) => [
      ...prev,
      {
        title: item.name,
        quantity: '1',
        unit: item.unit,
        unitPrice: item.price,
        discountPercent: null,
        vatRate: item.vatRate,
        vatIncluded: item.vatIncluded,
      },
    ]);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Выпуск документа"
      size="xl"
      busy={busy !== null}
      error={error}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          Проверьте состав и даты, посмотрите готовый файл — и выпустите документ. До выпуска
          заказчик его не видит.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field htmlFor="issue-type" label="Тип документа" hint={DOC_HINT[docType]}>
            <Select
              id="issue-type"
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value as IssueDocType);
                setParentDocumentId('');
                setMismatch(null);
              }}
            >
              {docTypes.map((kind) => (
                <option key={kind} value={kind}>
                  {DOC_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="issue-counterparty" label="Контрагент">
            <Input id="issue-counterparty" value={counterpartyName} readOnly />
          </Field>
          <Field htmlFor="issue-date" label="Дата документа">
            <Input
              id="issue-date"
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
            />
          </Field>
        </div>

        {(docType === 'act' || docType === 'extra_agreement') && (
          <Field
            htmlFor="issue-parent"
            label={docType === 'act' ? 'Счёт-основание' : 'Договор-основание'}
            hint={
              parentOptions.length > 0
                ? 'Документ наследует номер основания.'
                : docType === 'act'
                  ? 'Сначала выпустите счёт.'
                  : 'Сначала выпустите договор.'
            }
          >
            <Select
              id="issue-parent"
              value={parentDocumentId}
              onChange={(e) => setParentDocumentId(e.target.value)}
            >
              <option value="">Последний по дате</option>
              {parentOptions.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.number} от {new Date(doc.date).toLocaleDateString('ru-RU')}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {docType === 'act' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor="issue-period-from" label="Услуги оказаны с">
              <Input
                id="issue-period-from"
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
              />
            </Field>
            <Field htmlFor="issue-period-to" label="по">
              <Input
                id="issue-period-to"
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </Field>
          </div>
        )}

        {docType === 'contract' && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Подсказка обязана называть то, что подставится на самом деле:
                  без заказа названия заказа не существует (`У-145`). */}
              <Field
                htmlFor="issue-subject"
                label="Предмет договора"
                hint={withOrder ? 'Пусто — название заказа' : 'Пусто — «Оказание услуг»'}
              >
                <Input
                  id="issue-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
              <Field htmlFor="issue-valid-until" label="Действует до">
                <Input
                  id="issue-valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Field>
            </div>
            {/* `У-160`: «типовая формулировка» перестала быть правдой, как
                только у компании появился свой текст. Подсказка обязана
                называть то, что подставится на самом деле. */}
            <Field
              htmlFor="issue-payment-terms"
              label="Порядок оплаты"
              hint="Пусто — текст из шаблона документов. Номер пункта проставится сам."
            >
              <Textarea
                id="issue-payment-terms"
                rows={2}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
            </Field>
          </div>
        )}

        {docType === 'extra_agreement' && (
          <Field
            htmlFor="issue-change-text"
            label="Что меняется"
            hint="Пусто — текст из шаблона документов. Номер пункта проставится сам."
          >
            <Textarea
              id="issue-change-text"
              rows={3}
              value={changeText}
              onChange={(e) => setChangeText(e.target.value)}
            />
          </Field>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#111111]">Состав</h3>
            <div className="flex items-center gap-2">
              {catalog.length > 0 && (
                <Select
                  aria-label="Добавить из каталога"
                  data-testid="issue-catalog-picker"
                  value=""
                  onChange={(e) => addFromCatalog(e.target.value)}
                >
                  <option value="">Из каталога…</option>
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.code} · {item.price} ₽
                    </option>
                  ))}
                </Select>
              )}
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => setLines((prev) => [...prev, emptyLine(defaultVatRate)])}
              >
                Добавить строку
              </Button>
            </div>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-12 items-end">
              <div className="sm:col-span-4">
                <Field htmlFor={`line-title-${index}`} label="Наименование">
                  <Input
                    id={`line-title-${index}`}
                    value={line.title}
                    onChange={(e) => patchLine(index, { title: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field htmlFor={`line-qty-${index}`} label="Кол-во">
                  <Input
                    id={`line-qty-${index}`}
                    value={line.quantity}
                    onChange={(e) => patchLine(index, { quantity: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field htmlFor={`line-unit-${index}`} label="Ед.">
                  <Select
                    id={`line-unit-${index}`}
                    value={line.unit}
                    onChange={(e) => patchLine(index, { unit: e.target.value as CatalogUnit })}
                  >
                    {Object.entries(CATALOG_UNIT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field htmlFor={`line-price-${index}`} label="Цена">
                  <Input
                    id={`line-price-${index}`}
                    value={line.unitPrice}
                    onChange={(e) => patchLine(index, { unitPrice: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field htmlFor={`line-vat-${index}`} label="НДС">
                  <Select
                    id={`line-vat-${index}`}
                    value={line.vatRate ?? ''}
                    onChange={(e) =>
                      patchLine(index, { vatRate: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">без НДС</option>
                    {VAT_RATES.map((rate) => (
                      <option key={rate} value={rate.toFixed(4)}>
                        {(rate * 100).toFixed(0)}%
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                >
                  Убрать
                </Button>
              </div>
            </div>
          ))}
        </div>

        {blocked && (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-3"
            data-testid="issue-blocked"
          >
            {missing.length > 0 && (
              <>
                <p className="text-sm text-gray-800">
                  Для документа «{DOC_LABEL[docType]}» не хватает реквизитов:
                </p>
                <ul className="text-sm text-red-700 list-disc pl-5 mt-1 space-y-0.5">
                  {missing.map((m) => (
                    <li key={`${m.side}:${m.label}`}>{m.label}</li>
                  ))}
                </ul>
              </>
            )}
            {needsInvoice && (
              <p className="text-sm text-gray-800">Сначала выпустите счёт — акт наследует номер.</p>
            )}
            {needsContract && (
              <p className="text-sm text-gray-800">
                Сначала выпустите договор — доп. соглашение наследует его номер.
              </p>
            )}
          </div>
        )}

        {mismatch && (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 p-3"
            data-testid="issue-mismatch"
          >
            <p className="text-sm text-gray-900">
              Сумма по строкам — {mismatch.linesTotal} ₽, а сумма заказа — {mismatch.orderTotal} ₽.
              Что делать?
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button size="sm" disabled={busy !== null} onClick={() => void issue('update_order')}>
                Обновить сумму заказа
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void issue('keep_order')}
              >
                Выпустить по строкам
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setMismatch(null)}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}

        {previewUrl && (
          <iframe
            title="Предпросмотр документа"
            src={previewUrl}
            className="w-full h-96 rounded-lg border border-gray-200"
          />
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={busy !== null}
            onClick={() => void preview()}
          >
            {busy === 'preview' ? 'Готовлю…' : 'Предпросмотр'}
          </Button>
          <Button
            type="button"
            disabled={busy !== null || blocked || mismatch !== null}
            onClick={() => void issue()}
          >
            {busy === 'issue' ? 'Выпускаю…' : 'Выпустить'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
