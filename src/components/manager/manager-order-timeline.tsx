import React from 'react';
import type { AuditLog } from '@prisma/client';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

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
};

type AuditMetaShape = {
  before?: { executionStatus?: string };
  after?: { executionStatus?: string; actor?: string };
};

function summarizeAudit(entry: AuditLog): { label: string; detail: string | null } {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  if (entry.action !== 'order_status_changed') return { label, detail: null };
  const meta = (entry.meta ?? {}) as AuditMetaShape;
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
 * Manager-side sibling of `org-order-timeline.tsx`. In addition to the static
 * milestone rows the org version shows, this variant renders a filtered slice
 * of the order's audit log so a manager can see operator activity (status
 * changes, document uploads, comments) without leaving the page.
 *
 * Filtering rules (per plan):
 *   - HIDE rows whose `action` is in {partner_commission_*, partner_rate_changed}.
 *     Partner economics are out of manager scope.
 *   - SHOW `order_status_changed` with the before→after transition and the
 *     `actor` label from `meta.after.actor` when present (e.g. "manager",
 *     "system", "1c-sync"), so managers can tell whether the change came from
 *     a peer manager or from the 1С sync.
 */
export function ManagerOrderTimeline({
  order,
  auditEntries,
}: {
  order: ManagerOrderDetail;
  auditEntries: AuditLog[];
}) {
  const milestones: { label: string; date: Date | null; tone?: 'success' | 'warning' }[] = [
    { label: 'Создан', date: order.createdAt },
    { label: 'Договор подписан', date: order.contractSignedAt },
    { label: 'Дедлайн', date: order.deadline, tone: 'warning' },
    { label: 'Завершён', date: order.completedAt, tone: 'success' },
    { label: 'Оплачен', date: order.paidAt, tone: 'success' },
    { label: 'Закрыт', date: order.closedAt },
  ];

  const visibleAudit = auditEntries.filter((e) => !HIDDEN_ACTIONS.has(e.action));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-[#111111]">Даты</h2>
      <ul className="space-y-2">
        {milestones.map((e) => {
          const passed = e.date !== null;
          return (
            <li key={e.label} className="flex items-center gap-3 text-sm">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  !passed
                    ? 'bg-gray-200'
                    : e.tone === 'success'
                      ? 'bg-green-500'
                      : e.tone === 'warning'
                        ? 'bg-orange-400'
                        : 'bg-gray-400'
                }`}
              />
              <span className={`flex-1 ${passed ? 'text-[#111111]' : 'text-gray-400'}`}>
                {e.label}
              </span>
              <span className={`text-xs ${passed ? 'text-gray-500 font-medium' : 'text-gray-300'}`}>
                {fmtDate(e.date)}
              </span>
            </li>
          );
        })}
      </ul>

      {visibleAudit.length > 0 && (
        <div className="pt-3 border-t border-gray-100 space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Активность
          </h3>
          <ul className="space-y-2">
            {visibleAudit.map((entry) => {
              const { label, detail } = summarizeAudit(entry);
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
