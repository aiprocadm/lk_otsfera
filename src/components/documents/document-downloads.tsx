import React from 'react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/format';
import type { DownloadRow } from '@/lib/services/documents/history';

/**
 * «Кто скачивал» (`У-254`) — блок карточки документа у сотрудников ЦО.
 *
 * Показывает последние 20 выдач ссылки на файл (`В-8-2`): когда, кто, в какой
 * роли и какую версию унёс. Выдача подписанной ссылки и есть факт скачивания —
 * дальше файл забирают прямо из хранилища, и приложение об этом уже не знает.
 *
 * Клиенту и партнёру блок не показывается: список читателей — сведения о
 * работе исполнителя, а не свойство самой бумаги.
 */
export function DocumentDownloads({
  downloads,
  auditHref,
}: {
  downloads: DownloadRow[];
  /** Куда вести за полным журналом; `null` — у кабинета нет такого раздела. */
  auditHref: string | null;
}) {
  return (
    <section
      aria-labelledby="doc-downloads-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-3"
    >
      <h2 id="doc-downloads-heading" className="text-sm font-semibold text-[#111111]">
        Кто скачивал
      </h2>

      {downloads.length === 0 ? (
        <p className="text-sm text-gray-500">Документ ещё никто не скачивал.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {downloads.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <span className="text-gray-500">{fmtDateTime(d.at)}</span>
              <span className="text-[#111111]">{d.userName ?? '—'}</span>
              <span className="text-gray-500">{d.roleLabel}</span>
              {/* Версия у записей до этапа 8 не сохранялась — честный прочерк
                  вместо догадки «наверное, первая». */}
              <span className="text-gray-500">
                {d.version === null ? 'версия неизвестна' : `версия ${d.version}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400">
        Показаны последние 20 скачиваний.
        {auditHref && (
          <>
            {' '}
            <Link href={auditHref} className="text-[#F97316] hover:underline">
              Весь журнал действий
            </Link>
          </>
        )}
      </p>
    </section>
  );
}
