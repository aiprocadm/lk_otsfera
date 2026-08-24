import React from 'react';
import { Badge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { CertificateList, type CertificateListItem } from '@/components/training/certificate-list';
import type { OrgCardEmployeeDetail } from '@/lib/services/organization/orgCardEmployees';

/**
 * Карточка сотрудника **внутри карточки организации** (`У-97`).
 *
 * До этого шага карточка сотрудника у менеджера жила отдельным экраном
 * `/manager/students/[id]`, у заказчика — своим, а у партнёра её не было
 * вовсе: строка списка вела в никуда. Теперь экран один и тот же во всех
 * кабинетах — различаются только данные и права, которые даёт сервис роли
 * (`Р-23`).
 *
 * Компонент строго презентационный: в базу не ходит, прав не решает.
 */
export function OrgEmployeeCard({
  employee,
  certificates,
  customFields,
  actions,
}: {
  employee: OrgCardEmployeeDetail;
  certificates: CertificateListItem[];
  /** «Дополнительные поля» — готовым узлом: право правки решает сервер. */
  customFields?: React.ReactNode;
  /** Действия кабинета (например правка должности у заказчика). */
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-[#111111]">{employee.name}</h1>
          {employee.status !== 'active' && <Badge tone="neutral">В архиве</Badge>}
        </div>
        {/* §15 «что здесь делают»: одна строка простыми словами. */}
        <p className="text-sm text-gray-500">
          Сотрудник организации: его обучают, ему выдают удостоверения.
        </p>
        <p className="text-gray-400 text-xs pt-1">
          {employee.email ?? 'Почта не указана'} · Добавлен {fmtDate(employee.createdAt)}
        </p>

        {/* `У-30`: реквизиты справочника. Выдачу журналирует сервис (`У-31`) —
            СНИЛС, дата рождения и телефон это персональные данные. */}
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 pt-3 text-sm">
          <Detail label="Должность" value={employee.position} />
          <Detail label="СНИЛС" value={employee.snils} />
          <Detail
            label="Дата рождения"
            value={employee.birthDate ? fmtDate(employee.birthDate) : null}
          />
          <Detail label="Телефон" value={employee.phone} />
          <Detail label="Заметка" value={employee.note} />
        </dl>

        {actions && <div className="pt-3">{actions}</div>}
      </div>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-[#111111]">Удостоверения</h2>
        <CertificateList certificates={certificates} />
      </section>

      {customFields}
    </div>
  );
}

/** Строка реквизита: пустое значение показывается прочерком, а не пропадает (§15). */
function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 flex-shrink-0">{label}:</dt>
      <dd className="text-gray-800 break-words">{value ?? '—'}</dd>
    </div>
  );
}
