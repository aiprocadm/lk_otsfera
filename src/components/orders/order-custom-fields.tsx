'use client';

/**
 * «Дополнительные поля» на деталке заказа.
 *
 * Этап 1 PR-3 (§11 ТЗ v0.5): вся отрисовка переехала в общий
 * [`EntityCustomFields`](../custom-fields/entity-custom-fields.tsx) — он умеет
 * все 12 типов и решает право правки **по каждому полю** (`definition.editable`
 * приходит с сервера как «доступ к карточке ∧ роль в editableByRoles»).
 *
 * Здесь остался тонкий адаптер, чтобы не переписывать вызовы на пяти страницах
 * заказа. Проп `editable` — legacy-переключатель «кабинет вообще разрешает
 * правку»: он только СУЖАЕТ права, никогда не расширяет. Новые страницы его не
 * передают и полагаются на серверное решение.
 */

import React from 'react';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import type { FieldWithValue } from '@/lib/services/customFields';

export type OrderCustomFieldsProps = {
  fields: FieldWithValue[];
  orderId: string;
  /** Legacy-сужение прав кабинета. По умолчанию решает сервер. */
  editable?: boolean;
};

export function OrderCustomFields({ fields, orderId, editable = true }: OrderCustomFieldsProps) {
  const effective = editable
    ? fields
    : fields.map((f) => ({
        ...f,
        definition: { ...f.definition, editable: false },
      }));

  return <EntityCustomFields fields={effective} entityType="order" entityId={orderId} />;
}
