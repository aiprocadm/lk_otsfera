'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/ui/toast';
import { planImportRollbackAction, rollbackImportAction } from '@/server-actions/import';
import type {
  RollbackChannel,
  RollbackConflict,
  RollbackPlan,
} from '@/lib/services/import/rollback';

/**
 * Диалоги отката импорта — общие для Excel-истории и общей истории обмена
 * (`У-48`, `У-59`).
 *
 * Раньше эта машинка жила внутри `import-history.tsx`. С приходом отката
 * выписки её пришлось бы скопировать во вторую историю вместе со словарями
 * причин — а это ровно тот случай, когда две копии расходятся: текст поправят
 * в одной. Поэтому состояние и разметка вынесены сюда, а списки батчей
 * остаются каждый со своим видом.
 */

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

const ROLLBACK_ERRORS_RU: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  not_found: 'Импорт не найден',
  already_rolled_back: 'Этот импорт уже откачен',
  expired: 'Срок отката (30 дней) истёк',
  nothing_to_revert:
    'Отменять нечего: этот импорт был загружен до появления отмены, система не помнит, что именно он записал',
};

function conflictLine(c: RollbackConflict): string {
  const reason = CONFLICT_RU[c.code] ?? `связи: ${c.code}`;
  const count = c.count > 1 ? ` (${c.count})` : '';
  return `${ENTITY_RU[c.entity] ?? c.entity} «${c.label}» — ${reason}${count}`;
}

type RollbackTarget = { id: string; channel: RollbackChannel };

/**
 * Состояние одного отката: выбранный батч → план → подтверждение → результат.
 * `onDone` вызывается только после успеха (обычно `router.refresh()`).
 */
export function useRollbackFlow(onDone: () => void) {
  const [target, setTarget] = useState<RollbackTarget | null>(null);
  const [plan, setPlan] = useState<RollbackPlan | null>(null);
  const [conflicts, setConflicts] = useState<RollbackConflict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setTarget(null);
    setPlan(null);
    setConflicts(null);
    setError(null);
  }

  async function open(next: RollbackTarget) {
    setTarget(next);
    setPlan(null);
    setConflicts(null);
    setError(null);
    setBusy(true);
    try {
      const res = await planImportRollbackAction(next.id, next.channel);
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
      const res = await rollbackImportAction(target.id, partial, target.channel);
      if (res.ok) {
        toast.success(
          res.status === 'rolled_back'
            ? 'Импорт откачен полностью'
            : `Откачено частично: конфликтных строк — ${res.skippedConflicts}`
        );
        close();
        onDone();
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

  return { target, plan, conflicts, busy, error, open, close, execute };
}

export function RollbackDialogs({
  flow,
}: {
  flow: ReturnType<typeof useRollbackFlow>;
}): React.JSX.Element {
  const { target, plan, conflicts, busy, error, close, execute } = flow;
  return (
    <>
      {/* Диалог подтверждения (Т-39): явный текст «Будет удалено…». */}
      <Dialog
        open={!!target && conflicts === null}
        onClose={close}
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
              <Button variant="secondary" onClick={close} disabled={busy}>
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
        onClose={close}
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
            <Button variant="primary" onClick={close} disabled={busy} data-testid="rollback-cancel">
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
    </>
  );
}
