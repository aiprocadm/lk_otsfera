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
  createFunnelStageAction,
  updateFunnelStageAction,
  deleteFunnelStageAction,
} from '@/server-actions/funnel';
import type { FunnelStageView } from '@/lib/funnel/stages';

const ANCHORS: { value: string; label: string }[] = [
  { value: 'new', label: 'Новый лид' },
  { value: 'in_review', label: 'В работе' },
  { value: 'qualified', label: 'Квалифицирован' },
  { value: 'promoted_to_order', label: 'Передано в работу' },
  { value: 'rejected', label: 'Отказ' },
];
const anchorLabel = (a: string) => ANCHORS.find((x) => x.value === a)?.label ?? a;

export function StageConfig({
  stages,
  isDefault,
}: {
  stages: FunnelStageView[];
  isDefault: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ target: FunnelStageView | null } | null>(null);

  async function handleDelete(s: FunnelStageView) {
    const fd = new FormData();
    fd.set('id', s.id);
    const res = await deleteFunnelStageAction(fd);
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
          <h2 className="text-lg font-semibold text-[#111111]">Стадии воронки</h2>
          {isDefault && (
            <p className="text-xs text-gray-500 mt-0.5">
              Сейчас используются стадии по умолчанию. Создав свою первую стадию, вы замените набор
              — задайте все нужные стадии.
            </p>
          )}
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
        <StageDialog
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

function StageDialog({
  target,
  onClose,
  onSaved,
}: {
  target: FunnelStageView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (target) fd.set('id', target.id);
    setSubmitting(true);
    const res = target ? await updateFunnelStageAction(fd) : await createFunnelStageAction(fd);
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
        <Field htmlFor="st-name" label="Название">
          <Input
            id="st-name"
            name="name"
            required
            maxLength={60}
            defaultValue={target?.name ?? ''}
            autoFocus
          />
        </Field>
        <Field htmlFor="st-position" label="Позиция (порядок колонки)">
          <Input
            id="st-position"
            name="position"
            type="number"
            min={0}
            defaultValue={target?.position ?? 0}
          />
        </Field>
        <Field htmlFor="st-anchor" label="Якорь статуса (переход lifecycle)">
          <Select id="st-anchor" name="statusAnchor" defaultValue={target?.statusAnchor ?? 'new'}>
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
