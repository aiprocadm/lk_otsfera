'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { errorMessageRu } from '@/lib/errors/messages';
import { SERVICE_TYPE_LABEL } from '@/lib/orders/serviceType';
import { createOrderAction } from '@/server-actions/orders/create';

/**
 * «Создать заказ» в «Заказах» (этап 6 ТЗ 13.10.2026, `У-306`, `Р-6-5`):
 * клиент сразу готов работать — заказ заводится напрямую, без лида. После
 * создания — переход в карточку заказа.
 */
export function CreateOrderButton({
  organizations,
  ordersHref = '/manager/orders',
}: {
  organizations: { id: string; name: string }[];
  ordersHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await createOrderAction({
      organizationId: String(fd.get('organizationId') ?? ''),
      title: String(fd.get('title') ?? ''),
      serviceType:
        fd.get('serviceType') === 'document_development' ? 'document_development' : 'training',
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === 'not_found'
          ? 'Эта организация вам недоступна — выберите из списка.'
          : errorMessageRu(res.error, 'Не удалось создать заказ.')
      );
      return;
    }
    setOpen(false);
    router.push(`${ordersHref}/${res.orderId}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Создать заказ</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Новый заказ"
        busy={busy}
        error={error}
      >
        {organizations.length === 0 ? (
          <p className="text-sm text-gray-600">
            За вами пока не закреплено ни одной организации — заказ некому оформить. Сначала
            создайте организацию в разделе «Организации».
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-gray-500">
              Клиент сразу готов работать? Заказ создаётся без лида и сразу попадает в «Черновик
              заявки» с вами ответственным.
            </p>
            <Field htmlFor="co-org" label="Организация *">
              <Select id="co-org" name="organizationId" required defaultValue="">
                <option value="" disabled>
                  — выберите —
                </option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field htmlFor="co-title" label="Название заказа *">
              <Input id="co-title" name="title" required maxLength={200} />
            </Field>
            <Field htmlFor="co-type" label="Вид работ">
              <Select id="co-type" name="serviceType" defaultValue="training">
                {Object.entries(SERVICE_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Отмена
              </Button>
              <Button type="submit" loading={busy}>
                Создать
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
