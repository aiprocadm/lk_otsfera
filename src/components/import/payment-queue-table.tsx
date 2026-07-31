'use client';

import React, { useEffect, useState } from 'react';
import {
  dismissQueueRowAction,
  resolveQueueRowAction,
  searchResolveOrgsAction,
  listResolveOrdersAction
} from '@/server-actions/payment-import';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

export type QueueRow = {
  id: string; externalId: string; paidAt: string; amount: string; isRefund: boolean;
  purpose: string | null; counterpartyName: string | null; counterpartyInn: string | null;
  accountCandidates: string[]; candidateOrgId: string | null; candidateOrgName: string | null; matchMethod: string | null;
};

type OrgOption = { id: string; name: string; inn: string | null };
type OrderOption = { id: string; orderNumber: string | null; title: string };

// Стабильные коды ошибок resolveQueueRow → русские строки (иначе всплывает
// сырое `Ошибка: <code>`). Коды держим в синхроне с Err-union сервиса.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  not_found: 'Строка очереди не найдена — возможно, уже обработана',
  org_required: 'Выберите организацию',
  write_skipped: 'Оплата не записана: организация вне вашей зоны доступа или нет данных для привязки'
};
function errorMessage(code: string): string { return ERROR_MESSAGES[code] ?? `Ошибка: ${code}`; }

function orderLabel(o: OrderOption): string {
  return `${o.orderNumber ? `№${o.orderNumber} — ` : ''}${o.title}`;
}

export function PaymentQueueTable({ rows }: { rows: QueueRow[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<QueueRow | null>(null);
  const visible = rows.filter((r) => !hidden.has(r.id));

  function hide(id: string) { setHidden((s) => new Set(s).add(id)); }

  async function dismiss(id: string) {
    await dismissQueueRowAction({ rowId: id });
    hide(id);
  }

  if (visible.length === 0) return <p className="text-sm text-gray-500">Очередь пуста — все оплаты сопоставлены.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-gray-200 rounded">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th scope="col" className="text-left px-3 py-2 font-medium">Документ</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Дата</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Сумма</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Контрагент</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">№ счёта (кандидаты)</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Предложение</th>
            <th scope="col" className="text-left px-3 py-2 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-1.5 text-gray-700">{r.externalId}{r.isRefund ? ' (возврат)' : ''}</td>
              <td className="px-3 py-1.5 text-gray-700">{new Date(r.paidAt).toLocaleDateString('ru-RU')}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.amount}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.counterpartyName ?? '—'}{r.counterpartyInn ? ` (ИНН ${r.counterpartyInn})` : ''}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.accountCandidates.join(', ') || '—'}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.candidateOrgName ?? '—'}</td>
              <td className="px-3 py-1.5">
                <div className="flex gap-3">
                  <button type="button" onClick={() => setActive(r)} className="text-[#EA580C] hover:underline">Привязать</button>
                  <button type="button" onClick={() => dismiss(r.id)} className="text-red-600 hover:underline">Отклонить</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {active && (
        <BindRowDialog
          row={active}
          onClose={() => setActive(null)}
          onResolved={(id) => { hide(id); setActive(null); toast.success('Оплата привязана и проведена'); }}
        />
      )}
    </div>
  );
}

function BindRowDialog({ row, onClose, onResolved }: { row: QueueRow; onClose: () => void; onResolved: (id: string) => void }) {
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
      const withCandidate = row.candidateOrgId && row.candidateOrgName && !list.some((o) => o.id === row.candidateOrgId)
        ? [{ id: row.candidateOrgId, name: row.candidateOrgName, inn: null }, ...list]
        : list;
      setOrgs(withCandidate);
    });
    return () => { alive = false; };
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
    return () => { alive = false; };
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
    /* v8 ignore next -- unreachable: submit Button is disabled={!orgId}, so this branch never runs from a real click */
    if (!orgId) { setError(errorMessage('org_required')); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await resolveQueueRowAction({ rowId: row.id, organizationId: orgId, orderId: orderId || null });
      if (res.ok) { onResolved(row.id); return; }
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
          <Input id="bind-org-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Начните вводить…" />
        </Field>

        <Field htmlFor="bind-org" label="Организация">
          <Select id="bind-org" value={orgId} onChange={(e) => changeOrg(e.target.value)} invalid={!orgId}>
            <option value="">— выберите организацию —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.inn ? ` (ИНН ${o.inn})` : ''}</option>
            ))}
          </Select>
        </Field>

        <Field htmlFor="bind-order" label="Заказ (необязательно)" hint="Без заказа оплата привязывается на уровень организации">
          <Select id="bind-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!orgId || orders.length === 0}>
            <option value="">— без заказа —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{orderLabel(o)}</option>
            ))}
          </Select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Отмена</Button>
          <Button onClick={submit} loading={submitting} disabled={!orgId}>Привязать</Button>
        </div>
      </div>
    </Dialog>
  );
}
