import React from 'react';
import type { Role } from '@/lib/auth/jwt';
import { cabinetHeaderTitle } from '@/lib/navigation/cabinetIdentity';

/**
 * Подпись слева в шапке кабинета — один компонент на все кабинеты (`У-115`).
 *
 * Раньше каждый каркас рисовал её сам, и они разошлись: у партнёра тёмная
 * строка с ролью, у заказчика светлая с названием организации и почтой. Это
 * ровно то расхождение, которое запрещает §0.2: один и тот же объект — шапка —
 * выглядел в двух кабинетах по-разному без причины.
 *
 * Компонент строго презентационный (`Р-23`): что подставить второй половиной,
 * решает каркас своей роли, а не он.
 */
export function CabinetHeaderTitle({
  role,
  subject,
}: {
  role: Role | 'leader';
  subject: string | null;
}) {
  const { cabinet, subject: who } = cabinetHeaderTitle(role, subject);
  return (
    <>
      <span className="font-medium text-[#111111]">{cabinet}</span>
      {who ? <span className="ml-3 text-gray-500">· {who}</span> : null}
    </>
  );
}
