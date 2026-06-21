import React from 'react';

/**
 * Offset-пагинация (take/skip) для серверных списков. Domain-agnostic:
 * сохраняет все текущие query-параметры, кроме take/skip, и подставляет целевой skip.
 * Сам считает число страниц и возвращает null при ≤1 странице (вызывающему guard не нужен).
 * Извлечён из дублей в organization/orders и partner/deals (CLAUDE.md §4 — презентационный примитив).
 */
export function Paginator({
  basePath,
  searchParams,
  take,
  skip,
  total
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  take: number;
  skip: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / take));
  if (pages <= 1) return null;

  const page = Math.floor(skip / take) + 1;

  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === 'take' || k === 'skip') continue;
      if (typeof v === 'string' && v.length > 0) params.set(k, v);
    }
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      {/* template literal намеренно: React 19 вставляет comment-node (<!-- -->) между соседними {}-выражениями — не превращать обратно в JSX-интерполяции */}
      <span>{`Страница ${page} из ${pages} · ${total} всего`}</span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(prev)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(next)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
