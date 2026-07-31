'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Input,
  Select,
  Field,
  Dialog,
  TableShell,
  THead,
  Th,
  Tr,
  Td,
  Badge,
  ColorSwatchPicker,
} from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import {
  createDealStageAction,
  updateDealStageAction,
  deleteDealStageAction,
} from '@/server-actions/deals';
import type { DealStageView } from '@/lib/services/deals/stages';

/** Этап 6 (PR-1) — CRUD стадий сделок (клон funnel/stage-config под DealStageInput). */

const ANCHORS: { value: string; label: string }[] = [
  { value: 'open', label: 'В работе' },
  { value: 'won', label: 'Выиграна' },
  { value: 'lost', label: 'Проиграна' },
];
const anchorLabel = (a: string) => ANCHORS.find((x) => x.value === a)?.label ?? a;

export function DealStageConfig({
  stages,
  isDefault,
}: {
  stages: DealStageView[];
  isDefault: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ target: DealStageView | null } | null>(null);

  async function handleDelete(s: DealStageView) {
    const fd = new FormData();
    fd.set('id', s.id);
    const res = await deleteDealStageAction(fd);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось удалить стадию.'));
      return;
    }
    toast.success('Стадия удалена.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#111111]">Стадии сделок</h2>
          {isDefault && (
            <p className="text-xs text-gray-500 mt-0.5">
              Сейчас используются стадии по умолчанию. Создав свою первую стадию, вы замените набор
              — задайте все нужные стадии.
            </p>
          )}
          <p className="text-xs text-gray-500 mt-0.5">
            Стадии с якорем «Выиграна» / «Проиграна» — терминальные: попавшая туда сделка
            завершается.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ target: null })}>
          + Стадия
        </Button>
      </div>

      <TableShell>
        <THead>
          <Th>Позиция</Th>
          <Th>Название</Th>
          <Th>Якорь статуса</Th>
          <Th>Терминальная</Th>
          <Th>Действия</Th>
        </THead>
        <tbody>
          {stages.map((s) => (
            <Tr key={s.id}>
              <Td>{s.position}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td>
                <Badge tone="neutral">{anchorLabel(s.statusAnchor)}</Badge>
              </Td>
              <Td>{s.isTerminal ? 'Да' : '—'}</Td>
              <Td>
                {isDefault ? (
                  <span className="text-gray-400 text-sm">по умолчанию</span>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ target: s })}>
                      Изменить
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(s)}>
                      Удалить
                    </Button>
                  </div>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {editing && (
        <DealStageDialog
          key={editing.target?.id ?? 'new'}
          target={editing.target}
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

function DealStageDialog({
  target,
  onClose,
  onSaved,
}: {
  target: DealStageView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateDealStageAction(fd) : await createDealStageAction(fd);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error, 'Не удалось сохранить стадию.'));
      return;
    }
    toast.success(target ? 'Стадия обновлена.' : 'Стадия создана.');
    onSaved();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={target ? 'Изменить стадию' : 'Новая стадия'}
      size="md"
      busy={submitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="ds-name" label="Название">
          <Input
            id="ds-name"
            name="name"
            required
            maxLength={60}
            defaultValue={target?.name ?? ''}
            autoFocus
          />
        </Field>
        <Field htmlFor="ds-position" label="Позиция (порядок колонки)">
          <Input
            id="ds-position"
            name="position"
            type="number"
            min={0}
            defaultValue={target?.position ?? 0}
          />
        </Field>
        <Field htmlFor="ds-anchor" label="Якорь статуса (переход lifecycle)">
          <Select id="ds-anchor" name="statusAnchor" defaultValue={target?.statusAnchor ?? 'open'}>
            {ANCHORS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <ColorSwatchPicker name="color" value={target?.color ?? null} />
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            name="isTerminal"
            defaultChecked={target?.isTerminal ?? false}
            className="h-4 w-4 rounded"
          />
          <span>Терминальная стадия</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Сохраняю…' : target ? 'Сохранить' : 'Создать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
