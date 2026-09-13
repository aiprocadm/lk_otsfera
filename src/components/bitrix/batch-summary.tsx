import React from 'react';
import type { PipelineCounts } from '@/lib/services/bitrix/pipeline';
import {
  BITRIX_ENTITIES,
  BITRIX_ENTITY_TITLES,
  type BitrixEntity,
} from '@/lib/services/bitrix/mapping/types';

/**
 * Сводка предпросмотра по сущностям (`У-193`). Четыре числа на каждую:
 * создадим, обновим, пропустим, требует решения. Последнее — не «ошибка», а
 * работа для человека: пока в нём не ноль, применять пакет рано.
 */
export function BatchSummary({ counts }: { counts: PipelineCounts }) {
  const rows = BITRIX_ENTITIES.map((entity) => ({ entity, counts: counts[entity] })).filter(
    (r) => r.counts.create + r.counts.update + r.counts.skip + r.counts.conflict > 0
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        В выбранном периоде переносить нечего: источник не дал ни одной записи.
      </p>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
      {rows.map(({ entity, counts: c }) => (
        <EntityCard
          key={entity}
          entity={entity}
          create={c.create}
          update={c.update}
          skip={c.skip}
          conflict={c.conflict}
        />
      ))}
    </div>
  );
}

function EntityCard({
  entity,
  create,
  update,
  skip,
  conflict,
}: {
  entity: BitrixEntity;
  create: number;
  update: number;
  skip: number;
  conflict: number;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#111111] mb-2">{BITRIX_ENTITY_TITLES[entity]}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-gray-600">Создадим</div>
        <div className="font-medium" data-testid={`count-${entity}-create`}>
          {create}
        </div>
        <div className="text-gray-600">Обновим</div>
        <div className="font-medium" data-testid={`count-${entity}-update`}>
          {update}
        </div>
        <div className="text-gray-600">Пропустим</div>
        <div className="font-medium" data-testid={`count-${entity}-skip`}>
          {skip}
        </div>
        {conflict > 0 && (
          <>
            <div className="text-gray-600">Нужно решение</div>
            <div className="font-medium text-amber-700" data-testid={`count-${entity}-conflict`}>
              {conflict}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
