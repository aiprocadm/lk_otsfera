'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { createOrgFromLeadAction } from '@/server-actions/manager/leads';

/**
 * `У-161` (этап 7) — «Завести организацию» на карточке лида.
 *
 * Отдельная кнопка, а не побочный эффект чего-то ещё: до этого места лид
 * получал организацию ТОЛЬКО при создании, и «навесить» переход было не на
 * что. Здесь же переезжают выпущенные лиду коммерческие предложения — иначе у
 * одного клиента получились бы две нити бумаг: одна на лиде, невидимая из его
 * карточки, вторая новая.
 *
 * Форма нарочно без полей. Название, ИНН и КПП сервис берёт из карточки лида:
 * они там уже есть и уже показаны человеку прямо над кнопкой. Диалог с теми же
 * значениями заставлял бы подтверждать то, что и так видно, а поправить их
 * можно на карточке организации — там для этого есть отдельный экран с
 * проверкой контрольных сумм.
 */
export function CreateOrgFromLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    const res = await createOrgFromLeadAction({ leadId });
    setBusy(false);
    if (!res.ok) {
      toast.error(errorMessageRu(res.error));
      return;
    }
    // Говорим ровно то, что произошло: «создана» и «привязана существующая» —
    // разные события, и человек должен понимать, откуда взялась карточка с
    // чужой историей. Число переехавших бумаг называем всегда: ноль — это
    // тоже ответ, иначе человек пойдёт искать их на карточке организации.
    toast.success(
      `${res.created ? 'Организация создана' : 'Лид привязан к существующей организации'}. ` +
        `Предложений перенесено: ${res.transferred}.`
    );
    startTransition(() => router.refresh());
  }

  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={run}>
      Завести организацию
    </Button>
  );
}
