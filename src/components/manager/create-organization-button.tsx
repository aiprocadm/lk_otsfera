'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { createOrganizationAction } from '@/server-actions/organizations/create';
import { orgCreateErrorRu } from '@/lib/organizations/createErrors';

/**
 * «Создать организацию» в «Организациях» менеджера (этап 6 ТЗ 13.10.2026,
 * `У-308`, `Р-6-8`): новая организация сразу закреплена за создавшим, после
 * создания — переход в её карточку. Уже заведённую не дублируем: окно говорит
 * «такая уже есть» и даёт ссылку на неё.
 */
export function CreateOrganizationButton({
  orgsHref = '/manager/organizations',
}: {
  orgsHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const innTrimmed = inn.trim();
    const res = await createOrganizationAction({
      name,
      ...(innTrimmed ? { inn: innTrimmed } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === 'org_exists' && res.organizationId ? (
          <>
            {orgCreateErrorRu(res.error)}{' '}
            <Link href={`${orgsHref}/${res.organizationId}`} className="underline">
              Открыть
            </Link>
          </>
        ) : (
          orgCreateErrorRu(res.error)
        )
      );
      return;
    }
    setOpen(false);
    router.push(`${orgsHref}/${res.organizationId}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Создать организацию</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Новая организация"
        busy={busy}
        error={error}
      >
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-gray-500">
            Организация сразу закрепится за вами: вы увидите её в списке и сможете оформлять заказы.
          </p>
          <Field htmlFor="cor-name" label="Название *">
            <Input
              id="cor-name"
              name="name"
              required
              maxLength={300}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            htmlFor="cor-inn"
            label="ИНН"
            hint="10 цифр у организации, 12 — у ИП. Можно добавить позже."
          >
            <Input
              id="cor-inn"
              name="inn"
              inputMode="numeric"
              maxLength={12}
              value={inn}
              onChange={(e) => setInn(e.target.value)}
            />
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
      </Dialog>
    </>
  );
}
