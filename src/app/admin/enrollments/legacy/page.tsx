import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { listLegacyEnrollments } from '@/lib/services/enrollments/legacyDirections';
import { LegacyDirectionForm } from '@/components/enrollment/legacy-direction-form';
import { BackLink, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Разбор старых заявок без направления (`У-34а`, шаг 2, этап 6 ТЗ понятности).
 *
 * **Экран одноразовый.** До этапа 6 направление лежало на шапке заявки, и часть
 * заявок хранит курс текстом. Служебное направление «Без указания» заводить
 * запрещено (`Р-8`), поэтому направление им проставляет человек — здесь.
 *
 * Когда список опустеет, накатывается миграция, делающая направление позиции
 * обязательным, и экран убирается вместе с ней.
 */
export default async function AdminLegacyEnrollmentsPage() {
  await requireAdmin();

  const [rows, directions] = await Promise.all([
    listLegacyEnrollments(prisma),
    prisma.trainingDirection.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <BackLink href="/admin/enrollments" label="Заявки на обучение" />
        <h1 className="text-2xl font-bold text-[#111111] mt-1">Разбор старых заявок</h1>
        <p className="text-sm text-gray-600 mt-1">
          У этих заявок курс был вписан текстом, а не выбран из справочника. Укажите направление —
          оно проставится всем слушателям заявки.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="✅" message="Разбирать нечего — заявок без направления нет.">
          <p className="text-gray-400 text-xs mt-1">
            Можно накатывать миграцию, делающую направление обязательным.
          </p>
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-gray-500">
            Осталось разобрать: <strong>{rows.length}</strong>. Пока список не пуст, направление у
            позиции остаётся необязательным.
          </p>

          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="bg-white border border-gray-200 rounded-xl p-4 space-y-2"
                data-testid={`legacy-row-${r.id}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium text-[#111111]">{r.organizationName}</div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(r.createdAt)} · слушателей: {r.itemsCount}
                  </div>
                </div>
                <div className="text-sm text-gray-700">
                  Курс в заявке:{' '}
                  <span className="italic">{r.legacyCourseTitle ?? '— (текст не сохранён)'}</span>
                </div>
                <LegacyDirectionForm requestId={r.id} directions={directions} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
