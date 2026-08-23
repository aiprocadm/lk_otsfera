'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction,
  createOrgFromQueueRowAction,
  planQueueOrgCreationAction,
  createOrgsFromQueueRowsAction,
} from '@/server-actions/payment-import';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { toast } from '@/lib/ui/toast';
import { Paginator } from '@/components/ui/paginator';
import type { QueueRow } from '@/lib/services/import/oneCAccountCard/queue-view';
import { CompanyPicker } from './company-picker';
import { PaymentQueueToolbar } from './payment-queue-toolbar';

// Тип строки живёт в lib (нужен и странице, и компоненту) — CLAUDE.md §2.
export type { QueueRow } from '@/lib/services/import/oneCAccountCard/queue-view';

type OrgOption = { id: string; name: string; inn: string | null };
type OrderOption = { id: string; orderNumber: string | null; title: string };

// Стабильные коды ошибок resolveQueueRow → русские строки (иначе всплывает
// сырое `Ошибка: <code>`). Коды держим в синхроне с Err-union сервиса.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  not_found: 'Строка очереди не найдена — возможно, уже обработана',
  org_required: 'Выберите организацию',
  write_skipped:
    'Оплата не записана: организация вне вашей зоны доступа или нет данных для привязки',
  // Этап 10 (Т-30): создание организации из очереди.
  name_required: 'Укажите наименование организации',
  bad_inn: 'ИНН некорректен: нужно 10 или 12 цифр с верной контрольной суммой',
  org_exists: 'Организация с этим ИНН уже есть в базе — используйте кнопку «Привязать»',
  company_required: 'Выберите компанию для новой организации',
  bind_failed:
    'Организация создана, но оплату привязать не удалось — привяжите её кнопкой «Привязать»',
  // `У-53`: обычный менеджер организаций не заводит — ни по одной, ни пачкой.
  not_allowed: 'Заводить организации может администратор или руководитель',
};
function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `Ошибка: ${code}`;
}

function orderLabel(o: OrderOption): string {
  return `${o.orderNumber ? `№${o.orderNumber} — ` : ''}${o.title}`;
}

/**
 * `companies` передаёт только админская страница (Т-30/Т-41): admin выбирает
 * компанию новой организации в диалоге; руководителю компанию задаёт скоуп —
 * его страница проп не передаёт, и селекта нет.
 */
export function PaymentQueueTable({
  rows,
  companies,
  total,
  take,
  skip,
  basePath,
  searchParams,
}: {
  rows: QueueRow[];
  companies?: Array<{ id: string; name: string }>;
  /** `У-90`: сколько строк в очереди всего — без счётчика список врёт. */
  total: number;
  take: number;
  skip: number;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(false);
  const [active, setActive] = useState<QueueRow | null>(null);
  const [creating, setCreating] = useState<QueueRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const router = useRouter();
  const visible = rows.filter((r) => !hidden.has(r.id));

  function hide(id: string) {
    setHidden((s) => new Set(s).add(id));
  }

  async function dismiss(id: string) {
    await dismissQueueRowAction({ rowId: id });
    hide(id);
  }

  // Пустой экран отвечает на «почему пусто»: отфильтровали или разобрали
  // (`У-74` — пустое состояние обязано объяснять себя).
  const filtered = !!(searchParams.inn || searchParams.candidate);
  if (visible.length === 0)
    return (
      <div>
        <PaymentQueueToolbar
          basePath={basePath}
          searchParams={searchParams}
          total={total}
          take={take}
          skip={skip}
        />
        <p className="text-sm text-gray-500">
          {rows.length === 0 && filtered
            ? 'Под фильтр ничего не попало — снимите фильтры, чтобы увидеть очередь.'
            : 'Очередь пуста — все оплаты сопоставлены.'}
        </p>
      </div>
    );

  // У-18: семь колонок — самая широкая таблица проекта; на телефоне карточки.
  // Кнопки общие для обоих видов.
  const rowActions = (r: (typeof visible)[number]) => (
    <div className="flex gap-3">
      <button type="button" onClick={() => setActive(r)} className="text-[#EA580C] hover:underline">
        Привязать
      </button>
      {/* Т-30: только у строк с ИНН — без него создавать не из чего. */}
      {r.counterpartyInn && (
        <button
          type="button"
          onClick={() => setCreating(r)}
          className="text-[#EA580C] hover:underline"
          data-testid={`create-org-${r.id}`}
        >
          Создать организацию
        </button>
      )}
      <button type="button" onClick={() => dismiss(r.id)} className="text-red-600 hover:underline">
        Отклонить
      </button>
    </div>
  );

  // `У-53`: накопленные строки заводятся пачкой, а не по одной. Действие
  // обязательно двухшаговое (`Р-10`) — сам список живёт в диалоге.
  const anyWithInn = visible.some((r) => r.counterpartyInn);

  // `У-90`: строки одного контрагента (варианты написания дают один ключ
  // `У-83`) сворачиваются в группу — сорок платежей «Ромашки» это одна задача,
  // а не сорок. Группировка идёт по открытой странице: список уже отсортирован
  // по ключу, когда выбрана сортировка «по контрагенту».
  const groups = new Map<string, { title: string; rows: QueueRow[] }>();
  for (const r of visible) {
    const key = r.counterpartyKey ?? '';
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { title: r.counterpartyName ?? 'Без контрагента', rows: [r] });
  }

  return (
    <div>
      <PaymentQueueToolbar
        basePath={basePath}
        searchParams={searchParams}
        total={total}
        take={take}
        skip={skip}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {anyWithInn && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setBulk(true)}
            data-testid="bulk-create-orgs"
          >
            Создать организации по всем строкам с валидным ИНН
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setGrouped((g) => !g)}
          aria-pressed={grouped}
          data-testid="toggle-grouping"
        >
          {grouped ? 'Показать списком' : 'Группировать по контрагенту'}
        </Button>
      </div>

      {grouped && (
        <div className="mb-4 space-y-2" data-testid="queue-groups">
          {[...groups.entries()].map(([key, g]) => (
            <details
              key={key || 'none'}
              className="rounded border border-gray-200"
              data-testid={`queue-group-${key || 'none'}`}
            >
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700">
                {`${g.title} · строк: ${g.rows.length}`}
              </summary>
              <ul className="px-3 pb-2 text-xs text-gray-600">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 border-t py-1.5">
                    <span>{`${r.externalId} · ${new Date(r.paidAt).toLocaleDateString('ru-RU')} · ${r.amount}`}</span>
                    {rowActions(r)}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}

      {!grouped && (
      <CardList>
        {visible.map((r) => (
          <Card key={r.id} title={`${r.externalId}${r.isRefund ? ' (возврат)' : ''}`}>
            <CardRow label="Дата">{new Date(r.paidAt).toLocaleDateString('ru-RU')}</CardRow>
            <CardRow label="Сумма">{r.amount}</CardRow>
            <CardRow label="Контрагент">
              {r.counterpartyName ?? '—'}
              {r.counterpartyInn ? ` (ИНН ${r.counterpartyInn})` : ''}
            </CardRow>
            <CardRow label="№ счёта (кандидаты)">{r.accountCandidates.join(', ') || '—'}</CardRow>
            <CardRow label="Предложение">{r.candidateOrgName ?? '—'}</CardRow>
            <div className="pt-2 text-xs">{rowActions(r)}</div>
          </Card>
        ))}
      </CardList>
      )}

      {!grouped && (
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Документ
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Дата
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Сумма
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Контрагент
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                № счёта (кандидаты)
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Предложение
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-700">
                  {r.externalId}
                  {r.isRefund ? ' (возврат)' : ''}
                </td>
                <td className="px-3 py-1.5 text-gray-700">
                  {new Date(r.paidAt).toLocaleDateString('ru-RU')}
                </td>
                <td className="px-3 py-1.5 text-gray-700">{r.amount}</td>
                <td className="px-3 py-1.5 text-gray-700">
                  {r.counterpartyName ?? '—'}
                  {r.counterpartyInn ? ` (ИНН ${r.counterpartyInn})` : ''}
                </td>
                <td className="px-3 py-1.5 text-gray-700">
                  {r.accountCandidates.join(', ') || '—'}
                </td>
                <td className="px-3 py-1.5 text-gray-700">{r.candidateOrgName ?? '—'}</td>
                <td className="px-3 py-1.5">{rowActions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <Paginator
        basePath={basePath}
        searchParams={searchParams}
        take={take}
        skip={skip}
        total={total}
      />

      {active && (
        <BindRowDialog
          row={active}
          onClose={() => setActive(null)}
          onResolved={(id) => {
            hide(id);
            setActive(null);
            toast.success('Оплата привязана и проведена');
          }}
        />
      )}

      {bulk && (
        <BulkCreateOrgsDialog
          companies={companies}
          onClose={() => setBulk(false)}
          onDone={(created, bound) => {
            setBulk(false);
            toast.success(
              `Создано организаций: ${created}` + (bound > 0 ? `, привязано оплат: ${bound}` : '')
            );
            router.refresh();
          }}
        />
      )}

      {creating && (
        <CreateOrgDialog
          row={creating}
          companies={companies}
          onClose={() => setCreating(null)}
          onResolved={(id) => {
            hide(id);
            setCreating(null);
            toast.success('Организация создана, оплата привязана');
          }}
        />
      )}
    </div>
  );
}

/**
 * `У-53` + решение `Р-10`: пакетное создание — строго два шага. Первый шаг
 * показывает, ЧТО будет создано (название, ИНН, сколько строк подтянется);
 * снятая галочка исключает контрагента. Без показанного списка второй шаг
 * недоступен: кнопка «Создать» появляется только после загрузки плана.
 */
function BulkCreateOrgsDialog({
  companies,
  onClose,
  onDone,
}: {
  companies?: Array<{ id: string; name: string }> | undefined;
  onClose: () => void;
  onDone: (created: number, bound: number) => void;
}) {
  const [candidates, setCandidates] = useState<Array<{
    rowId: string;
    name: string;
    inn: string;
    alsoRows: number;
  }> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Единственная компания подставляется без вопроса — как в формах импорта.
  const single = companies?.length === 1 ? companies[0] : undefined;
  const [companyId, setCompanyId] = useState(single ? single.id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await planQueueOrgCreationAction();
        if (!alive) return;
        if (res.ok) {
          setCandidates(res.candidates);
          setChosen(new Set(res.candidates.map((c) => c.rowId)));
        } else {
          setError(errorMessage(res.error));
        }
      } catch {
        if (alive) setError('Сервер недоступен — попробуйте ещё раз');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function toggle(rowId: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await createOrgsFromQueueRowsAction({
        rowIds: [...chosen],
        ...(companyId ? { companyId } : {}),
      });
      if (res.ok) {
        onDone(res.result.created, res.result.bound);
        return;
      }
      setError(errorMessage(res.error));
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Создать организации по строкам очереди"
      busy={busy}
      error={error}
    >
      {candidates === null ? (
        <p className="text-sm text-gray-500">Считаем, что можно создать…</p>
      ) : candidates.length === 0 ? (
        <div className="space-y-3 text-sm text-gray-700">
          <p data-testid="bulk-empty">
            Создавать нечего: в очереди нет строк с валидным ИНН, для которых организации ещё нет.
            Такие строки привязывают кнопкой «Привязать».
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            Будет создано организаций: <strong data-testid="bulk-count">{chosen.size}</strong> из{' '}
            {candidates.length}. Снимите галочку, чтобы пропустить.
          </p>
          <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="bulk-candidates">
            {candidates.map((c) => (
              <li key={c.rowId}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.rowId)}
                    onChange={() => toggle(c.rowId)}
                    data-testid={`bulk-row-${c.rowId}`}
                  />
                  <span>
                    <span className="font-medium text-[#111111]">{c.name || 'без названия'}</span> ·
                    ИНН {c.inn}
                    {c.alsoRows > 0 ? ` · подтянется оплат: ${c.alsoRows + 1}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <CompanyPicker
            companies={companies}
            value={companyId}
            onChange={setCompanyId}
            idPrefix="bulk-org"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={busy || chosen.size === 0}
              data-testid="bulk-confirm"
            >
              Создать
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Диалог Т-30: предзаполненные редактируемые поля, создание — только по кнопке
 * оператора. Т-31: «Подтянуть по ИНН» через существующий DaData-прокси; нет
 * ключа/не нашлось — тихая подсказка, ручной ввод работает как раньше.
 */
function CreateOrgDialog({
  row,
  companies,
  onClose,
  onResolved,
}: {
  row: QueueRow;
  companies?: Array<{ id: string; name: string }> | undefined;
  onClose: () => void;
  onResolved: (id: string) => void;
}) {
  const [name, setName] = useState(row.counterpartyName ?? '');
  /* v8 ignore next -- фолбэк '' недостижим: кнопка «Создать организацию» рендерится только у строк с непустым counterpartyInn, других точек открытия диалога нет */
  const [inn, setInn] = useState(row.counterpartyInn ?? '');
  const [kpp, setKpp] = useState('');
  const [companyId, setCompanyId] = useState(row.batchCompanyId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Т-31: DaData по ИНН. Прокси деградирует в пустой список — не ошибка.
  async function fetchByInn() {
    setFetching(true);
    setHint(null);
    try {
      const res = await fetch(`/api/suggest/party?query=${encodeURIComponent(inn.trim())}`);
      const body = (await res.json()) as {
        suggestions?: Array<{ name: string; inn: string; kpp: string | null }>;
      };
      const found = body.suggestions?.find((s) => s.inn === inn.trim()) ?? body.suggestions?.[0];
      if (found) {
        setName(found.name);
        if (found.kpp) setKpp(found.kpp);
      } else {
        setHint('По этому ИНН ничего не нашлось — заполните поля вручную.');
      }
    } catch {
      setHint('Подсказки недоступны — заполните поля вручную.');
    } finally {
      setFetching(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await createOrgFromQueueRowAction({
        rowId: row.id,
        name,
        inn,
        kpp: kpp.trim() || null,
        ...(companies && companyId ? { companyId } : {}),
      });
      if (res.ok) {
        onResolved(row.id);
        return;
      }
      setError(errorMessage(res.error));
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Создать организацию и привязать"
      busy={submitting}
      error={error}
      notice={hint}
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          {row.externalId} · {row.amount} · оплата будет привязана к новой организации
        </p>

        <Field htmlFor="create-org-inn" label="ИНН">
          <div className="flex gap-2">
            <Input
              id="create-org-inn"
              value={inn}
              onChange={(e) => setInn(e.target.value)}
              invalid={!inn.trim()}
            />
            <Button
              variant="secondary"
              onClick={() => void fetchByInn()}
              loading={fetching}
              disabled={!inn.trim()}
              data-testid="create-org-dadata"
            >
              Подтянуть по ИНН
            </Button>
          </div>
        </Field>

        <Field htmlFor="create-org-name" label="Наименование">
          <Input
            id="create-org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={!name.trim()}
          />
        </Field>

        <Field htmlFor="create-org-kpp" label="КПП (необязательно)">
          <Input id="create-org-kpp" value={kpp} onChange={(e) => setKpp(e.target.value)} />
        </Field>

        {/* Т-41: admin выбирает компанию; руководителю её задаёт скоуп. */}
        {companies && (
          <Field htmlFor="create-org-company" label="Компания новой организации">
            <Select
              id="create-org-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              invalid={!companyId}
            >
              <option value="">— выберите компанию —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            loading={submitting}
            disabled={!name.trim() || !inn.trim() || (!!companies && !companyId)}
            data-testid="create-org-submit"
          >
            Создать и привязать
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function BindRowDialog({
  row,
  onClose,
  onResolved,
}: {
  row: QueueRow;
  onClose: () => void;
  onResolved: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgId, setOrgId] = useState(row.candidateOrgId ?? '');
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Поиск организаций (scoped в server-action). Пустой запрос = первая страница
  // доступного скоупа — у менеджера это весь его список, у админа — топ-N.
  useEffect(() => {
    let alive = true;
    void searchResolveOrgsAction({ q: query }).then((res) => {
      if (!alive) return;
      // Кандидат от fuzzy-match мог не попасть в выборку — подставим его явно,
      // чтобы предзаполненный выбор оставался валидной опцией.
      const list = res as OrgOption[];
      const withCandidate =
        row.candidateOrgId && row.candidateOrgName && !list.some((o) => o.id === row.candidateOrgId)
          ? [{ id: row.candidateOrgId, name: row.candidateOrgName, inn: null }, ...list]
          : list;
      setOrgs(withCandidate);
    });
    return () => {
      alive = false;
    };
  }, [query, row.candidateOrgId, row.candidateOrgName]);

  // Заказы выбранной организации (опционально; org-level платёж при пустом выборе).
  // Сброс зависимого состояния делаем в обработчике выбора (changeOrg), а не в
  // теле эффекта — это паттерн React (no synchronous setState in effect body).
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void listResolveOrdersAction({ organizationId: orgId }).then((res) => {
      if (!alive) return;
      setOrders(res as OrderOption[]);
      // Defensive: this effect only (re-)runs when orgId changes, and the sole
      // setter (changeOrg) always resets orderId to '' synchronously before the
      // async fetch resolves — so `cur` is always '' here and the "found" branch
      // (returning `cur` unchanged) is unreachable via the current call sites.
      // Kept as a safety net against a future caller that pre-seeds orderId.
      /* v8 ignore next -- unreachable: changeOrg always resets orderId to '' before this resolves, so `cur` is never a matching id */
      setOrderId((cur) => ((res as OrderOption[]).some((o) => o.id === cur) ? cur : ''));
    });
    return () => {
      alive = false;
    };
  }, [orgId]);

  function changeOrg(id: string) {
    setOrgId(id);
    setOrderId('');
    if (!id) setOrders([]);
  }

  async function submit() {
    // Defensive guard: unreachable via the UI since the only caller is the
    // submit Button, which is `disabled={!orgId}` — the click that would
    // invoke submit() never fires while orgId is falsy.
    /* v8 ignore start -- unreachable: submit Button is disabled={!orgId}, so this branch never runs from a real click */
    if (!orgId) {
      setError(errorMessage('org_required'));
      return;
    }
    /* v8 ignore stop */
    setSubmitting(true);
    setError(null);
    try {
      const res = await resolveQueueRowAction({
        rowId: row.id,
        organizationId: orgId,
        orderId: orderId || null,
      });
      if (res.ok) {
        onResolved(row.id);
        return;
      }
      setError(errorMessage(res.error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Привязать оплату" busy={submitting} error={error}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          {row.externalId} · {row.amount} · {row.counterpartyName ?? 'без контрагента'}
          {row.counterpartyInn ? ` (ИНН ${row.counterpartyInn})` : ''}
        </p>

        <Field htmlFor="bind-org-search" label="Поиск организации" hint="Название, ИНН или код 1С">
          <Input
            id="bind-org-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Начните вводить…"
          />
        </Field>

        <Field htmlFor="bind-org" label="Организация">
          <Select
            id="bind-org"
            value={orgId}
            onChange={(e) => changeOrg(e.target.value)}
            invalid={!orgId}
          >
            <option value="">— выберите организацию —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.inn ? ` (ИНН ${o.inn})` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="bind-order"
          label="Заказ (необязательно)"
          hint="Без заказа оплата привязывается на уровень организации"
        >
          <Select
            id="bind-order"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            disabled={!orgId || orders.length === 0}
          >
            <option value="">— без заказа —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {orderLabel(o)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={submit} loading={submitting} disabled={!orgId}>
            Привязать
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
