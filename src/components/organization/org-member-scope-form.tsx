'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { errorMessageRu } from '@/lib/errors/messages';
import { setOrgMemberScopeAction } from '@/server-actions/organization/memberScope';

/**
 * `У-236` — «Сотрудники видят только свои заказы» в секции «Доступ в кабинет».
 *
 * Правило организации, а не личная настройка, поэтому живёт рядом со списком
 * участников. Меняет его только администратор организации; остальные видят
 * текущее состояние словами — скрывать правило от тех, кого оно касается,
 * незачем.
 */
export function OrgMemberScopeForm({
  organizationId,
  value,
  canEdit,
}: {
  organizationId: string;
  value: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(value);
  const [busy, setBusy] = useState(false);

  async function save(next: boolean) {
    setBusy(true);
    const previous = checked;
    setChecked(next);
    try {
      const fd = new FormData();
      fd.set('organizationId', organizationId);
      if (next) fd.set('value', 'on');
      const res = await setOrgMemberScopeAction(fd);
      if (!res.ok) {
        setChecked(previous);
        toast.error(errorMessageRu(res.error, 'Не удалось сохранить настройку.'));
        return;
      }
      toast.success(
        next
          ? 'Сотрудники теперь видят только свои заказы.'
          : 'Сотрудники снова видят все заказы организации.'
      );
      router.refresh();
    } catch {
      setChecked(previous);
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <p className="text-xs text-gray-500" data-testid="member-scope-view">
        {value
          ? 'Сотрудники видят только свои заказы: те, где они указаны контактным лицом или подали обращение. Настройку меняет администратор организации.'
          : 'Сотрудники видят все заказы организации. Настройку меняет администратор организации.'}
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="member-scope-form">
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={busy}
          onChange={(e) => void save(e.target.checked)}
        />
        <span>Сотрудники видят только свои заказы</span>
      </label>
      <p className="text-xs text-gray-500">
        «Свой» заказ — тот, где сотрудник указан контактным лицом или сам подал обращение.
        Администраторы и руководители организации видят все заказы всегда.
      </p>
      {busy && (
        <Button size="sm" variant="secondary" loading disabled>
          Сохраняем
        </Button>
      )}
    </div>
  );
}
