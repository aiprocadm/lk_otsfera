'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { filterStudentsByQuery, studentOptionLabel } from '@/lib/training/studentSearch';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';

type Direction = { id: string; name: string };
type Student = { id: string; name: string; email: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  orderId: string;
  directions: Direction[];
  students: Student[];
};

export function AddPositionDialog({ open, onClose, orderId, directions, students }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [studentId, setStudentId] = useState('');
  const [query, setQuery] = useState('');
  const [directionId, setDirectionId] = useState('');
  const [note, setNote] = useState('');

  // `У-352`: список сужается по мере ввода ФИО. Выбранный слушатель остаётся в
  // списке, даже если новый запрос его не находит, — иначе `<select>` молча
  // показал бы «— Выберите слушателя —», а в состоянии остался бы прежний id.
  const found = filterStudentsByQuery(students, query);
  const selected = students.find((s) => s.id === studentId);
  const options = selected && !found.includes(selected) ? [selected, ...found] : found;

  function resetForm() {
    setStudentId('');
    setQuery('');
    setDirectionId('');
    setNote('');
    setError(undefined);
  }

  function handleClose() {
    if (!busy) {
      resetForm();
      onClose();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId || !directionId) {
      setError('Выберите слушателя и направление.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/manager/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, directionId, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errorMessageRu(body?.error ?? 'unknown'));
        return;
      }
      toast.success('Слушатель добавлен');
      resetForm();
      onClose();
      router.refresh();
    } catch {
      setError(errorMessageRu('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Добавить слушателя"
      size="md"
      busy={busy}
      error={error}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Найти слушателя"
          htmlFor="add-pos-student-search"
          hint={
            query.trim()
              ? found.length > 0
                ? `Найдено: ${found.length} из ${students.length}`
                : 'Никого не нашли — проверьте написание или очистите поле'
              : 'Начните вводить фамилию, имя или почту'
          }
        >
          <Input
            id="add-pos-student-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
            placeholder="Например, Петров Иван"
            autoComplete="off"
          />
        </Field>

        <Field label="Слушатель" htmlFor="add-pos-student">
          <Select
            id="add-pos-student"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Выберите слушателя —</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {studentOptionLabel(s)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Направление обучения" htmlFor="add-pos-direction">
          <Select
            id="add-pos-direction"
            value={directionId}
            onChange={(e) => setDirectionId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Выберите направление —</option>
            {directions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Примечание (необязательно)" htmlFor="add-pos-note">
          <Textarea
            id="add-pos-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="Дополнительная информация"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Добавление…' : 'Добавить'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
