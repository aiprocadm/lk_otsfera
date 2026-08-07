'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { planImportRollbackAction, rollbackImportAction } from '@/server-actions/import';
import type {
  ImportBatchListItem,
  RollbackConflict,
  RollbackPlan,
} from '@/lib/services/import/rollback';

/**
 * «История импортов» (этап 9 ТЗ починки импорта, Т-39/Т-40): последние 20
 * батчей с кнопкой «Откатить». Подтверждение — вторым диалогом с явным
 * «Будет удалено: …»; при конфликтах — третий выбор с дефолтом «Отменить»
 * (Т-37). Компонент общий для admin- и leader-страниц (презентационный,
 * скоуп режет сервер).
 */

const STATUS_RU: Record<string, string> = {
  committed: 'выполнен',
  rolled_back: 'откачен',
  rollback_partial: 'откачен частично',
};

/** Русские тексты причин конфликта (коды — из сервиса отката, §4.2 спеки). */
const CONFLICT_RU: Record<string, string> = {
  payment_in_commission_act: 'платёж уже в акте комиссии',
  payment_has_correction: 'у платежа есть корректировка комиссии',
  order_has_status_changes: 'у заказа есть смены статуса',
  order_has_documents: 'у заказа есть документы',
  order_in_commission_act: 'заказ уже в акте комиссии',
  order_has_foreign_payments: 'у заказа есть платежи не из этого импорта',
  order_has_other_links: 'у заказа есть другие связи',
  org_has_users: 'у организации есть пользователи',
  org_has_requests: 'у организации есть заявки',
  org_has_deals: 'у организации есть сделки',
  org_has_certificates: 'у организации есть удостоверения',
  org_has_students: 'у организации есть слушатели',
  org_has_leads: 'у организации есть лиды',
  org_has_foreign_orders: 'у организации есть заказы не из этого импорта',
  org_has_foreign_payments: 'у организации есть платежи не из этого импорта',
  org_has_other_links: 'у организации есть другие связи',
  record_missing: 'запись уже удалена вручную — восстанавливать нечего',
  blocked_by_child: 'внутри остаются заблокированные записи этого же импорта',
};

const ENTITY_RU: Record<string, string> = {
  organization: 'организация',
  order: 'заказ',
  payment: 'платёж',
};

function conflictLine(c: RollbackConflict): string {
  const reason = CONFLICT_RU[c.code] ?? `связи: ${c.code}`;
  const count = c.count > 1 ? ` (${c.count})` : '';
  return `${ENTITY_RU[c.entity] ?? c.entity} «${c.label}» — ${reason}${count}`;
}

function countsLine(counts: ImportBatchListItem['counts']): string {
  const c = counts as {
    orgs?: { created?: number; updated?: number };
    orders?: { created?: number; updated?: number };
    payments?: { created?: number; updated?: number };
  } | null;
  if (!c) return '—';
  const part = (label: string, e?: { created?: number; updated?: number }) =>
    `${label} +${e?.created ?? 0}/~${e?.updated ?? 0}`;
  return `${part('орг.', c.orgs)} · ${part('заказы', c.orders)} · ${part('оплаты', c.payments)}`;
}

const ROLLBACK_ERRORS_RU: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  not_found: 'Импорт не найден',
  already_rolled_back: 'Этот импорт уже откачен',
  expired: 'Срок отката (30 дней) истёк',
};

export function ImportHistory({ batches }: { batches: ImportBatchListItem[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<ImportBatchListItem | null>(null);
  const [plan, setPlan] = useState<RollbackPlan | null>(null);
  const [conflicts, setConflicts] = useState<RollbackConflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeAll() {
    setTarget(null);
    setPlan(null);
    setConflicts(null);
    setError(null);
  }

  async function openDialog(batch: ImportBatchListItem) {
    setTarget(batch);
    setPlan(null);
    setConflicts(null);
    setError(null);
    setBusy(true);
    try {
      const res = await planImportRollbackAction(batch.id);
      if (res.ok) setPlan(res.plan);
      else setError(ROLLBACK_ERRORS_RU[res.error] ?? `Ошибка: ${res.error}`);
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  }

  async function execute(partial: boolean) {
    /* v8 ignore next -- защитный guard: кнопки диалогов существуют только при выбранном батче */
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rollbackImportAction(target.id, partial);
      if (res.ok) {
        toast.success(
          res.status === 'rolled_back'
            ? 'Импорт откачен полностью'
            : `Откачено частично: конфликтных строк — ${res.skippedConflicts}`
        );
        closeAll();
        router.refresh();
        return;
      }
      if (res.error === 'conflicts') {
        // Т-37: показать список и дать выбор; дефолт — «Отменить».
        setConflicts(res.conflicts ?? []);
        return;
      }
      setError(ROLLBACK_ERRORS_RU[res.error] ?? `Ошибка: ${res.error}`);
    } catch {
      setError('Сервер недоступен — попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  }

  if (batches.length === 0) {
    return <p className="text-sm text-gray-500">Импортов ещё не было.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Дата
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Файл
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Кто
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Создано/обновлено
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Статус
              </th>
              <th scope="col" className="text-left px-3 py-2 font-medium">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-gray-100" data-testid={`batch-${b.id}`}>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {new Date(b.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2 text-gray-700">{b.fileName}</td>
                <td className="px-3 py-2 text-gray-700">{b.importedByName ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {countsLine(b.counts)}
                </td>
                <td className="px-3 py-2 text-gray-700">{STATUS_RU[b.status] ?? b.status}</td>
                <td className="px-3 py-2">
                  {b.rollback === 'already_rolled_back' ? (
                    <span className="text-xs text-gray-400">откачен</span>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={b.rollback === 'expired'}
                      title={
                        b.rollback === 'expired'
                          ? 'Срок отката (30 дней) истёк — данные живут слишком долго, на них уже могло что-то завязаться'
                          : undefined
                      }
                      onClick={() => void openDialog(b)}
                      data-testid={`rollback-${b.id}`}
                    >
                      Откатить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Диалог подтверждения (Т-39): явный текст «Будет удалено…». */}
      <Dialog
        open={!!target && conflicts === null}
        onClose={closeAll}
        title="Откатить импорт?"
        busy={busy}
        error={error}
      >
        {plan ? (
          <div className="space-y-3 text-sm text-gray-700">
            <p data-testid="rollback-summary">
              Будет удалено: {plan.toDelete.organizations} организаций, {plan.toDelete.orders}{' '}
              заказов, {plan.toDelete.payments} платежей. Будет восстановлено: {plan.toRestore}{' '}
              записей.
            </p>
            {plan.conflicts.length > 0 && (
              <p className="text-amber-700">
                Есть конфликты ({plan.conflicts.length}) — часть строк откатить нельзя, выбор будет
                на следующем шаге.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={closeAll} disabled={busy}>
                Отмена
              </Button>
              <Button
                variant="danger"
                onClick={() => void execute(false)}
                disabled={busy}
                data-testid="rollback-confirm"
              >
                Откатить
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Готовим план отката…</p>
        )}
      </Dialog>

      {/* Диалог конфликтов (Т-36/Т-37): дефолт — «Отменить» целиком. */}
      <Dialog
        open={conflicts !== null}
        onClose={closeAll}
        title="Нельзя откатить целиком"
        busy={busy}
        error={error}
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>Часть записей уже «обросла» связями — их откат заблокирован:</p>
          <ul className="list-disc pl-5 space-y-0.5" data-testid="rollback-conflicts">
            {(conflicts ?? []).map((c, i) => (
              <li key={i}>{conflictLine(c)}</li>
            ))}
          </ul>
          <p className="text-gray-500">
            Можно отменить откат целиком (безопаснее) или откатить только строки без конфликтов —
            конфликтные останутся, оператор разбирает их вручную.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="primary"
              onClick={closeAll}
              disabled={busy}
              data-testid="rollback-cancel"
            >
              Отменить
            </Button>
            <Button
              variant="secondary"
              onClick={() => void execute(true)}
              disabled={busy}
              data-testid="rollback-partial"
            >
              Откатить только безопасные
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
