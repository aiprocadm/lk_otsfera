import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { VersionRow } from '@/lib/services/documents/versions';

/**
 * «История версий» загруженного документа (`У-251`) — блок карточки у
 * сотрудников ЦО.
 *
 * Компонент презентационный: цепочку собрал сервис, здесь только показ. Строк
 * в цепочке единицы, поэтому это обычный список, а не таблица с постраничностью.
 *
 * Клиенту и партнёру блок не показывается: им отдаётся действующая версия, а
 * кто и сколько раз её переделывал — внутренняя кухня исполнителя.
 */
export function DocumentVersionHistory({
  versions,
  currentId,
  hrefBase,
}: {
  versions: VersionRow[];
  /** Какая из версий открыта сейчас — её не делаем ссылкой на саму себя. */
  currentId: string;
  /** База ссылки на документ в этом кабинете, например `/manager/documents`. */
  hrefBase: string;
}) {
  if (versions.length < 2) return null;

  // Сверху — последняя версия: с ней и работают.
  const rows = [...versions].reverse();

  return (
    <section
      aria-labelledby="doc-versions-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
    >
      <h2 id="doc-versions-heading" className="text-sm font-semibold text-[#111111]">
        История версий
      </h2>
      <ul className="divide-y divide-gray-100">
        {rows.map((v) => (
          <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <span className="font-medium text-[#111111]">{`Версия ${v.version}`}</span>
            {v.supersededAt === null ? (
              <Badge tone="success">действующая</Badge>
            ) : (
              <Badge tone="neutral">{`заменена ${fmtDateTime(v.supersededAt)}`}</Badge>
            )}
            <span className="text-gray-500">{fmtDateTime(v.createdAt)}</span>
            <span className="text-gray-500">{v.uploadedByName ?? '—'}</span>
            {v.id === currentId ? (
              <span className="text-gray-400 break-all">{v.name}</span>
            ) : (
              <Link
                href={`${hrefBase}/${v.id}`}
                className="text-[#F97316] hover:underline break-all"
              >
                {v.name}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
