'use client';

import React, { useState } from 'react';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  createAutomationRuleAction,
  updateAutomationRuleAction,
} from '@/server-actions/admin/automationRules';
import {
  AUTOMATION_TRIGGER_OPTIONS,
  AUTOMATION_PLACEHOLDER_HINTS,
  previewAutomationText,
} from '@/lib/automation/uiCatalog';
import type { AutomationRuleView } from '@/lib/services/automation/rules';

/**
 * Форма правила «Если … → То …» (`У-222`).
 *
 * Правило намеренно короткое: событие, один получатель, один текст. Заказчик
 * просил обойтись без графического редактора (`01` §4) — и это же делает
 * правило понятным без обучения.
 *
 * **Предпросмотр подстановок — не украшение.** Человек пишет
 * `{{document.number}}`, а видит «Проверить оплату по счёту С-2026-17». Без
 * него первый раз узнать, что получится, можно было бы только дождавшись
 * настоящего срабатывания. Неизвестную подстановку сервер откажется сохранить
 * (§9 пакета), и здесь же о ней говорится прямо.
 */

type Cabinet = 'admin' | 'leader';

export function AutomationRuleForm({
  cabinet,
  companyId,
  rule,
  onClose,
  onSaved,
}: {
  cabinet: Cabinet;
  companyId: string;
  /** `null` — создаём новое правило. */
  rule: AutomationRuleView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const first = rule?.actions[0];
  const [name, setName] = useState(rule?.name ?? '');
  const [trigger, setTrigger] = useState<string>(rule?.trigger ?? 'document_issued');
  const [kind, setKind] = useState<'create_task' | 'notify' | 'send_message'>(
    first?.kind ?? 'create_task'
  );
  const [text, setText] = useState(
    first?.kind === 'create_task' ? first.titleTemplate : (first?.template ?? '')
  );
  const [assignee, setAssignee] = useState<string>(
    first?.kind === 'create_task'
      ? first.assignee
      : first?.kind === 'notify'
        ? first.audience
        : 'responsible_manager'
  );
  const [dueInDays, setDueInDays] = useState<string>(
    first?.kind === 'create_task' && first.dueInDays !== undefined ? String(first.dueInDays) : ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const actions = [
      kind === 'create_task'
        ? {
            kind: 'create_task' as const,
            titleTemplate: text,
            assignee,
            ...(dueInDays.trim() ? { dueInDays: Number(dueInDays) } : {}),
          }
        : kind === 'notify'
          ? { kind: 'notify' as const, audience: assignee, template: text }
          : { kind: 'send_message' as const, channel: 'email' as const, template: text },
    ];

    const input = { name, trigger, actions };
    setBusy(true);
    const res = rule
      ? await updateAutomationRuleAction(cabinet, companyId, rule.id, input)
      : await createAutomationRuleAction(cabinet, companyId, input);
    setBusy(false);

    if (!res.ok) {
      // Неизвестную подстановку называем поимённо: «ошибка сохранения» без
      // указания, что именно не так, отправила бы человека гадать.
      const message =
        res.error === 'unknown_placeholder' && res.unknown?.length
          ? `Неизвестная подстановка: ${res.unknown.map((u) => `{{${u}}}`).join(', ')}`
          : errorMessageRu(res.error, 'Не удалось сохранить правило.');
      setError(message);
      return;
    }
    toast.success(rule ? 'Правило изменено.' : 'Правило создано и пока выключено.');
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? 'Изменить правило' : 'Новое правило'}
      size="lg"
      busy={busy}
      {...(error ? { error } : {})}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm text-gray-700">Название правила</span>
          <Input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Счёт выставлен — проверить оплату"
            aria-label="Название правила"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-gray-700">Если случилось</span>
          <Select value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="Событие">
            {AUTOMATION_TRIGGER_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.labelRu}
              </option>
            ))}
          </Select>
          <span className="block text-xs text-gray-500">
            {AUTOMATION_TRIGGER_OPTIONS.find((t) => t.key === trigger)?.hintRu}
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-gray-700">То сделать</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            aria-label="Действие"
          >
            <option value="create_task">Создать задачу</option>
            <option value="notify">Сообщить сотруднику</option>
            <option value="send_message">Написать клиенту</option>
          </Select>
        </label>

        {kind === 'send_message' && (
          <p className="rounded-lg bg-[#FFF7ED] p-3 text-sm text-[#9A3412]">
            Сообщение уйдёт клиенту <strong>без участия менеджера</strong>. Включайте это правило,
            только если текст подходит для любого случая, когда событие происходит.
          </p>
        )}

        {kind !== 'send_message' && (
          <label className="block space-y-1">
            <span className="text-sm text-gray-700">Кому</span>
            <Select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              aria-label="Кому"
            >
              <option value="responsible_manager">Ответственному менеджеру объекта</option>
              <option value="role:leader">Руководителю</option>
            </Select>
            <span className="block text-xs text-gray-500">
              Если ответственного нет, задача уйдёт руководителю — она не потеряется.
            </span>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm text-gray-700">
            {kind === 'create_task' ? 'Название задачи' : 'Текст сообщения'}
          </span>
          <Textarea
            required
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Проверить оплату по счёту {{document.number}}"
            aria-label="Текст правила"
          />
        </label>

        {kind === 'create_task' && (
          <label className="block space-y-1">
            <span className="text-sm text-gray-700">Срок, дней (необязательно)</span>
            <Input
              type="number"
              min={0}
              max={365}
              className="w-32"
              value={dueInDays}
              onChange={(e) => setDueInDays(e.target.value)}
              aria-label="Срок в днях"
            />
          </label>
        )}

        <section className="space-y-2 rounded-lg bg-[#F3F4F6] p-3">
          <h3 className="text-sm font-medium text-[#111111]">Как это будет выглядеть</h3>
          <p className="text-sm text-gray-700" data-testid="automation-preview">
            {text.trim()
              ? previewAutomationText(text)
              : 'Напишите текст выше — здесь будет пример.'}
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-gray-500">
              Что можно подставить в текст
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
              {AUTOMATION_PLACEHOLDER_HINTS.map((h) => (
                <li key={h.token}>
                  <code>{`{{${h.token}}}`}</code> — {h.labelRu}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
