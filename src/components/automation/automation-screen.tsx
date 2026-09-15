'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Select, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { settingsSectionHref } from '@/lib/navigation/settings';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { toggleAutomationRuleAction, deleteAutomationRuleAction } from '@/server-actions/admin/automationRules';
import type { AutomationRuleView, AutomationRunView } from '@/lib/services/automation/rules';
import { AutomationRuleForm } from './automation-rule-form';

/**
 * Раздел «Автоматизация» (`У-222`, `У-223`, `У-224`) — один экран на два
 * кабинета сотрудников (`Р-23`: презентационный компонент, данные и права даёт
 * страница роли).
 *
 * Отличие администратора ровно одно: он выбирает компанию. Платформенных правил
 * нет — робот, создающий задачи сразу во всех компаниях, это не функция.
 *
 * §15 «три вопроса»: заголовок и крошки отвечают «где я», подзаголовок — «что
 * здесь делают», кнопка «Новое правило» — «что дальше». Пустой список
 * объясняет, зачем раздел нужен, и не оставляет человека наедине с серым
 * пятном (`У-74`).
 */

type Cabinet = 'admin' | 'leader';

const RUN_STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  ok: { label: 'Выполнено', tone: 'success' },
  failed: { label: 'Не выполнено', tone: 'danger' },
  skipped: { label: 'Пропущено', tone: 'neutral' },
};

export function AutomationScreen({
  cabinet,
  companyId,
  companies,
  rules,
  runs,
}: {
  cabinet: Cabinet;
  companyId: string | null;
  /** Список компаний — только у администратора; руководителю не нужен. */
  companies: { id: string; name: string }[];
  rules: AutomationRuleView[];
  runs: AutomationRunView[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ rule: AutomationRuleView | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const self = settingsSectionHref('catalogs.automation', cabinet);
  const crumbs = buildCabinetBreadcrumbs(cabinet, `/${cabinet}/settings`, [
    { label: 'Автоматизация' },
  ]);

  async function toggle(rule: AutomationRuleView, isActive: boolean) {
    setBusy(true);
    const res = await toggleAutomationRuleAction(cabinet, companyId, rule.id, isActive);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось переключить правило.'));
      return;
    }
    toast.success(isActive ? 'Правило включено.' : 'Правило выключено.');
    startTransition(() => router.refresh());
  }

  async function remove(rule: AutomationRuleView) {
    if (!window.confirm(`Удалить правило «${rule.name}»? Отменить это нельзя.`)) return;
    setBusy(true);
    const res = await deleteAutomationRuleAction(cabinet, companyId, rule.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить правило.'));
      return;
    }
    toast.success('Правило удалено.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={crumbs}
        title="Автоматизация"
        subtitle="Правила «если случилось событие — создай задачу или сообщи коллеге». Новое правило выключено, пока вы его не включите."
        action={
          companyId ? (
            <Button size="sm" onClick={() => setEditing({ rule: null })}>
              + Новое правило
            </Button>
          ) : undefined
        }
      />

      {cabinet === 'admin' && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">Компания</h2>
          <p className="text-sm text-gray-500">
            Правила заводятся отдельно для каждой компании — общих для всех правил нет.
          </p>
          <Select
            aria-label="Компания"
            className="w-full max-w-md"
            value={companyId ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              router.push(value ? `${self ?? ''}?companyId=${encodeURIComponent(value)}` : (self ?? ''));
            }}
          >
            <option value="">Выберите компанию</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </section>
      )}

      {!companyId ? (
        <EmptyState
          icon="🤖"
          title={cabinet === 'admin' ? 'Компания не выбрана' : 'Компания не определена'}
          message={
            cabinet === 'admin'
              ? 'Выберите компанию выше — правила у каждой свои.'
              : 'Ваша учётная запись не привязана к компании, поэтому правил здесь нет. Обратитесь к администратору.'
          }
        />
      ) : rules.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="Правил пока нет"
          message="Правило избавляет от ручной рутины: «счёт выставлен — через пять дней проверить оплату». Заведите первое."
          action={<Button onClick={() => setEditing({ rule: null })}>+ Новое правило</Button>}
        />
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[#111111]">Правила</h2>
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="space-y-2 rounded-xl border border-gray-200 bg-white p-4"
                data-testid={`automation-rule-${rule.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#111111]">{rule.name}</span>
                      <Badge tone={rule.isActive ? 'success' : 'neutral'}>
                        {rule.isActive ? 'Включено' : 'Выключено'}
                      </Badge>
                      {rule.isBuiltin && <Badge tone="info">Из коробки</Badge>}
                    </div>
                    <p className="text-sm text-gray-600">
                      Если: {rule.triggerLabel}. То: {describeActions(rule)}.
                    </p>
                    <p className="text-xs text-gray-400">
                      {rule.runsTotal > 0
                        ? `Срабатывало ${rule.runsTotal} раз, последний — ${fmt(rule.lastRunAt)}`
                        : 'Ещё не срабатывало'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => toggle(rule, !rule.isActive)}
                    >
                      {rule.isActive ? 'Выключить' : 'Включить'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setEditing({ rule })}
                    >
                      Изменить
                    </Button>
                    {/* Правило из коробки не удаляется — его выключают: иначе
                        набор «правил из коробки» у компаний разошёлся бы, и
                        объяснить это было бы нечем (`У-224`). */}
                    {!rule.isBuiltin && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => remove(rule)}
                      >
                        Удалить
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {companyId && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#111111]">Журнал срабатываний</h2>
            <Link href={`/${cabinet}/settings`} className="text-xs text-gray-400 hover:underline">
              Все настройки
            </Link>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">
              Срабатываний пока не было. Здесь появится, что именно сделал каждый робот.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Когда</th>
                    <th className="py-2 pr-4 font-medium">Правило</th>
                    <th className="py-2 pr-4 font-medium">Итог</th>
                    <th className="py-2 font-medium">Что сделано</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs.map((run) => {
                    const status = RUN_STATUS[run.status] ?? {
                      label: run.status,
                      tone: 'neutral' as const,
                    };
                    return (
                      <tr key={run.id}>
                        <td className="py-2 pr-4 text-gray-600">{fmt(run.at)}</td>
                        <td className="py-2 pr-4 text-[#111111]">{run.ruleName}</td>
                        <td className="py-2 pr-4">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                        <td className="py-2 text-gray-600">
                          {run.error ? (
                            // Причину показываем целиком: без неё «не выполнено»
                            // не говорит человеку ничего.
                            <span className="text-red-600">{run.error}</span>
                          ) : (
                            describeOutcome(run)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editing && companyId && (
        <AutomationRuleForm
          key={editing.rule?.id ?? 'new'}
          cabinet={cabinet}
          companyId={companyId}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function fmt(at: Date | null): string {
  return at ? new Date(at).toLocaleString('ru-RU') : '—';
}

function describeActions(rule: AutomationRuleView): string {
  if (rule.actions.length === 0) return 'действие не задано';
  return rule.actions
    .map((a) =>
      a.kind === 'create_task'
        ? 'создать задачу'
        : a.kind === 'notify'
          ? 'сообщить сотруднику'
          : 'написать клиенту'
    )
    .join(', ');
}

function describeOutcome(run: AutomationRunView): string {
  const parts: string[] = [];
  if (run.createdTasks > 0) parts.push(`задач: ${run.createdTasks}`);
  if (run.notified > 0) parts.push(`уведомлений: ${run.notified}`);
  return parts.length > 0 ? parts.join(', ') : 'без изменений';
}
