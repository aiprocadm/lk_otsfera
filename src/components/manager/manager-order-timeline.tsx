import React from 'react';
import type { AuditLog } from '@prisma/client';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';
import { fmtDateTime } from '@/lib/format';

const HIDDEN_ACTIONS = new Set<string>([
  // Partner-economics events: managers never see commission/rate audit rows
  // (see plan §5 — manager scope intentionally hides partner economics).
  'partner_commission_rate_changed',
  'partner_commission_paid',
  'partner_commission_recalculated',
  'partner_rate_changed',
]);

const ACTION_LABELS: Record<string, string> = {
  order_status_changed: 'Статус изменён',
  document_uploaded: 'Документ загружен',
  comment_posted: 'Комментарий',
  // `У-283`: смена ответственного видна в истории заказа.
  order_manager_changed: 'Ответственный изменён',
  order_self_assigned: 'Взят в работу',
};

type AuditMetaShape = {
  before?: { executionStatus?: string; managerId?: string | null };
  after?: { executionStatus?: string; actor?: string; managerId?: string | null };
};

function summarizeAudit(
  entry: AuditLog,
  userNames: Record<string, string>
): { label: string; detail: string | null } {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const meta = (entry.meta ?? {}) as AuditMetaShape;
  const who = (id: string | null | undefined): string =>
    id ? (userNames[id] ?? 'сотрудник') : 'никто';
  if (entry.action === 'order_manager_changed') {
    return { label, detail: `${who(meta.before?.managerId)} → ${who(meta.after?.managerId)}` };
  }
  if (entry.action === 'order_self_assigned') {
    return { label, detail: who(meta.after?.managerId) };
  }
  if (entry.action !== 'order_status_changed') return { label, detail: null };
  const before = meta.before?.executionStatus;
  const after = meta.after?.executionStatus;
  const actor = meta.after?.actor;
  const parts: string[] = [];
  if (before && after) parts.push(`${before} → ${after}`);
  else if (after) parts.push(after);
  if (actor) parts.push(`актор: ${actor}`);
  return { label, detail: parts.length > 0 ? parts.join(' · ') : null };
}

/**
 * Блок «Журнал изменений» карточки заказа сотрудника: срез журнала аудита —
 * загрузка документов, комментарии, смена ответственного, смены статуса с
 * «кто сделал» (`meta.after.actor`: менеджер, система, 1С).
 *
 * Скрыты строки экономики партнёра (`partner_commission_*`,
 * `partner_rate_changed`) — менеджеру она не видна.
 *
 * Этап 5 ТЗ 28.10.2026 (`У-353`, РК 9): прежний блок «Даты» (создан, договор,
 * дедлайн, завершён, оплачен, закрыт) убран — даты переходов есть в «Истории
 * статусов» панели статуса, а фиксированные вехи со статусами заказа не
 * совпадали. У заказчика и партнёра «Даты» остаются: истории статусов у них
 * нет (их хронологию решает `У-366` этапа 7).
 */
export function ManagerOrderTimeline({
  order,
  auditEntries,
  userNames = {},
}: {
  order: Pick<ManagerOrderDetail, 'lastSyncedAt'>;
  auditEntries: AuditLog[];
  /** `У-283`: имена для строк смены ответственного. */
  userNames?: Record<string, string>;
}) {
  const visibleAudit = auditEntries.filter((e) => !HIDDEN_ACTIONS.has(e.action));
  if (visibleAudit.length === 0 && !order.lastSyncedAt) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[#111111]">Журнал изменений</h2>
      {visibleAudit.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-2">
            {visibleAudit.map((entry) => {
              const { label, detail } = summarizeAudit(entry, userNames);
              return (
                <li key={entry.id} className="text-sm flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[#111111]">{label}</div>
                    {detail && <div className="text-xs text-gray-500 mt-0.5">{detail}</div>}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {fmtDateTime(entry.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {order.lastSyncedAt && (
        <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
          Обновлено из 1С: {fmtDateTime(order.lastSyncedAt)}
        </div>
      )}
    </div>
  );
}
