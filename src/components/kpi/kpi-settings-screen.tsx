'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  copyKpiTargetsAction,
  setActiveMetricsAction,
  upsertKpiTargetAction,
} from '@/server-actions/kpi';
import type { KpiSettingsView } from '@/lib/services/kpi/settings';

/**
 * «Показатели и планы» (`У-242`, этап 7).
 *
 * Два дела на одном экране: какие показатели компания вообще считает своими и
 * какой план стоит у каждого менеджера на месяц. Оба ответа на вопрос «что
 * здесь делают» (§15) написаны словами, а не подразумеваются.
 */
const ERRORS: Record<string, string> = {
  too_many: 'Больше восьми показателей на дашборд не помещается — снимите лишние.',
  invalid: 'Проверьте значения: план — положительное число.',
  forbidden: 'Нет прав менять показатели этой компании.',
  not_found: 'Компания или сотрудник не найдены — обновите страницу.',
};

function unitHint(unit: string): string {
  if (unit === 'money') return '₽';
  if (unit === 'minutes') return 'мин';
  return 'шт';
}

export function KpiSettingsScreen({ view }: { view: KpiSettingsView }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [active, setActive] = React.useState<string[]>(view.active);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(
          ERRORS[res.error ?? ''] ??
            errorMessageRu(res.error ?? 'internal', 'Не удалось сохранить.')
        );
        return;
      }
      toast.success(okText);
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string, on: boolean) {
    const next = on ? [...active, key] : active.filter((k) => k !== key);
    setActive(next);
    const fd = new FormData();
    for (const k of next) fd.append('metric', k);
    void run(() => setActiveMetricsAction(fd), 'Набор показателей сохранён.');
  }

  function saveTarget(metric: string, managerId: string, value: string) {
    const fd = new FormData();
    fd.set('metric', metric);
    fd.set('managerId', managerId);
    fd.set('year', String(view.year));
    fd.set('month', String(view.month));
    fd.set('amount', value);
    void run(() => upsertKpiTargetAction(fd), 'План сохранён.');
  }

  function copyPrevious() {
    const fd = new FormData();
    fd.set('year', String(view.year));
    fd.set('month', String(view.month));
    void run(async () => {
      const res = await copyKpiTargetsAction(fd);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    }, 'Планы скопированы с прошлого месяца.');
  }

  const activeMetrics = view.available.filter((m) => active.includes(m.key));

  return (
    <div className="space-y-6" data-testid="kpi-settings">
      <PageHeader
        title="Показатели и планы"
        subtitle="Выберите, что компания считает своими показателями, и поставьте план каждому менеджеру на месяц."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
          Что считаем (до восьми)
        </h2>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {view.available.map((m) => (
            <li key={m.key} className="rounded-xl border border-gray-200 bg-white p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={active.includes(m.key)}
                  disabled={busy}
                  data-testid={`metric-${m.key}`}
                  onChange={(e) => toggle(m.key, e.target.checked)}
                />
                <span>
                  <span className="font-medium text-[#111111]">{m.label}</span>
                  <span className="ml-1 text-xs text-gray-500">({unitHint(m.unit)})</span>
                  <span className="block text-xs text-gray-500">{m.hint}</span>
                  {!m.perManager && (
                    <span className="block text-xs text-gray-500">
                      Считается по компании: ответственного у этих данных нет.
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-gray-500">
            Планы на {String(view.month).padStart(2, '0')}.{view.year}
          </h2>
          <Button size="sm" variant="secondary" disabled={busy} onClick={copyPrevious}>
            Скопировать с прошлого месяца
          </Button>
        </div>

        {activeMetrics.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="Показатели не выбраны"
            message="Отметьте выше, что компания считает своими показателями — тогда здесь появятся планы."
            className="p-6"
          />
        ) : (
          activeMetrics.map((m) => (
            <div key={m.key} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-[#111111]">
                {m.label} <span className="text-xs text-gray-500">({unitHint(m.unit)})</span>
              </p>
              {m.perManager ? (
                <ul className="space-y-2">
                  {view.managers.map((mgr) => (
                    <li key={mgr.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-[12rem] text-gray-700">
                        {mgr.name}
                        {!mgr.isActive && <span className="text-gray-400"> (не работает)</span>}
                      </span>
                      <Input
                        className="w-40"
                        inputMode="decimal"
                        defaultValue={view.targets[`${m.key}:${mgr.id}`] ?? ''}
                        placeholder="план не задан"
                        disabled={busy}
                        data-testid={`target-${m.key}-${mgr.id}`}
                        onBlur={(e) => saveTarget(m.key, mgr.id, e.target.value)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-[12rem] text-gray-700">По компании целиком</span>
                  <Input
                    className="w-40"
                    inputMode="decimal"
                    defaultValue={view.targets[`${m.key}:`] ?? ''}
                    placeholder="план не задан"
                    disabled={busy}
                    data-testid={`target-${m.key}-company`}
                    onBlur={(e) => saveTarget(m.key, '', e.target.value)}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
