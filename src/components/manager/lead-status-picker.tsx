'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeadStatus } from '@prisma/client';
import { LeadStatusBadge, leadStatusLabel } from '@/components/partner/lead-status-badge';
import { leadStatusTransitions } from '@/lib/leads/statuses';
import { toast } from '@/lib/ui/toast';

/**
 * Статус лида прямо из списка (этап 6 ТЗ 13.10.2026, `У-307`, `Р-6-7`): клик
 * по бейджу открывает список статусов, куда лид можно перевести; смена — тем
 * же действием, что в карточке лида (`PATCH /api/manager/leads/[id]`,
 * `setStatus`). Конечные статусы («стал заказом», «отклонён») — просто бейдж:
 * их меняют действиями карточки, а не выбором.
 */
export function LeadStatusPicker({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = leadStatusTransitions(status);
  if (next.length === 0) return <LeadStatusBadge status={status} />;

  async function change(to: LeadStatus) {
    setBusy(true);
    try {
      const res = await fetch(`/api/manager/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setStatus', status: to }),
      });
      if (!res.ok) {
        toast.error('Статус не сменился — обновите страницу: лид мог уже измениться.');
        return;
      }
      toast.success(`Статус: ${leadStatusLabel(to)}`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Нет связи с сервером — попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Статус: ${leadStatusLabel(status)} — сменить`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={busy}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-[#F97316]"
      >
        <LeadStatusBadge status={status} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Сменить статус лида"
          className="absolute z-10 mt-1 min-w-[12rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {next.map((s) => (
            <li key={s} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-orange-50"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void change(s);
                }}
              >
                {leadStatusLabel(s)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
