'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TableShell,
  THead,
  Th,
  Tr,
  Td,
  Badge,
  Button,
  Select,
  Dialog,
  Field,
  Input,
} from '@/components/ui';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import type { OrderItemRow } from '@/lib/services/training';
import { AddPositionDialog } from '@/components/training/add-position-dialog';

export const TRAINING_STATUS_RU: Record<string, string> = {
  pending: 'Ожидает',
  in_progress: 'Обучается',
  certificate_issued: 'Удостоверение выдано',
  cancelled: 'Отменено',
};

type Direction = { id: string; name: string };
type Student = { id: string; name: string; email: string | null };

type Props = {
  orderId: string;
  canEdit: boolean;
  items: OrderItemRow[];
  directions: Direction[];
  students: Student[];
};

type IssueCertState = {
  itemId: string;
  studentName: string;
};

function IssueCertDialog({
  state,
  onClose,
}: {
  state: IssueCertState | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [number, setNumber] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [validUntil, setValidUntil] = useState('');

  function resetForm() {
    setNumber('');
    setIssuedAt('');
    setValidUntil('');
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
    if (!number.trim() || !issuedAt) {
      setError('Укажите номер и дату выдачи удостоверения.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch('/api/manager/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId: state!.itemId,
          number: number.trim(),
          issuedAt,
          validUntil: validUntil || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(errorMessageRu(body?.error ?? 'unknown'));
        return;
      }
      toast.success('Удостоверение выдано');
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
      open={state !== null}
      onClose={handleClose}
      title={`Выдать удостоверение — ${state?.studentName ?? ''}`}
      size="sm"
      busy={busy}
      error={error}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Номер удостоверения" htmlFor="cert-number">
          <Input
            id="cert-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={busy}
            placeholder="Например: АБ-12345"
          />
        </Field>
        <Field label="Дата выдачи" htmlFor="cert-issued-at">
          <Input
            id="cert-issued-at"
            type="date"
            value={issuedAt}
            onChange={(e) => setIssuedAt(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Действителен до (необязательно)" htmlFor="cert-valid-until">
          <Input
            id="cert-valid-until"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            disabled={busy}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Сохранение…' : 'Выдать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function OrderItemsSection({ orderId, canEdit, items, directions, students }: Props) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [issueCert, setIssueCert] = useState<IssueCertState | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  async function handleStatusChange(itemId: string, trainingStatus: string) {
    setStatusBusy(itemId);
    try {
      const res = await fetch(`/api/manager/order-items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainingStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(errorMessageRu(body?.error ?? 'unknown'));
        return;
      }
      toast.success('Статус обновлён');
      router.refresh();
    } catch {
      toast.error(errorMessageRu('network'));
    } finally {
      setStatusBusy(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#111111]">
          Слушатели{' '}
          {items.length > 0 && <span className="text-gray-400 font-normal">({items.length})</span>}
        </h2>
        {canEdit && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Добавить слушателя
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">Слушатели не добавлены.</p>
      ) : (
        <TableShell overflow="x-auto">
          <THead>
            <Th>ФИО</Th>
            <Th>Направление</Th>
            <Th>Статус</Th>
            <Th>Удостоверение</Th>
            {canEdit && <Th>Действия</Th>}
          </THead>
          <tbody>
            {items.map((item) => (
              <Tr key={item.id}>
                <Td>
                  <div className="font-medium">{item.student.name}</div>
                  <div className="text-xs text-gray-400">{item.student.email}</div>
                </Td>
                <Td>{item.direction.name}</Td>
                <Td>
                  {canEdit ? (
                    <Select
                      value={item.trainingStatus}
                      onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      disabled={statusBusy === item.id}
                      className="w-auto"
                    >
                      {Object.entries(TRAINING_STATUS_RU).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{TRAINING_STATUS_RU[item.trainingStatus] ?? item.trainingStatus}</Badge>
                  )}
                </Td>
                <Td>
                  {item.certificate ? (
                    <span className="text-sm">{item.certificate.number}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </Td>
                {canEdit && (
                  <Td>
                    {!item.certificate && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setIssueCert({ itemId: item.id, studentName: item.student.name })
                        }
                        disabled={statusBusy === item.id}
                      >
                        Выдать удостоверение
                      </Button>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {canEdit && (
        <>
          <AddPositionDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            orderId={orderId}
            directions={directions}
            students={students}
          />
          <IssueCertDialog state={issueCert} onClose={() => setIssueCert(null)} />
        </>
      )}
    </div>
  );
}
