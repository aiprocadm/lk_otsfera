'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, Button, Field, Select, Textarea } from '@/components/ui';
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
  const [directionId, setDirectionId] = useState('');
  const [note, setNote] = useState('');

  function resetForm() {
    setStudentId('');
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
        <Field label="Слушатель" htmlFor="add-pos-student">
          <Select
            id="add-pos-student"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            disabled={busy}
          >
            <option value="">— Выберите слушателя —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.email})
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
