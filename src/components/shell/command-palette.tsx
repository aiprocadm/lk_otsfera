'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { paletteSearchAction } from '@/server-actions/search';
import type { SearchGroup } from '@/lib/services/search/globalSearch';

/**
 * Командная палитра (`У-75`, этап 9): Ctrl/Cmd+K — и сразу переход в нужный
 * раздел, без похода по меню.
 *
 * **Разделы берутся из меню своей роли** — их отдаёт каркас кабинета, уже
 * отфильтрованными по флагам и правам. Палитра не строит свой список путей и
 * поэтому не может показать раздел, которого у человека нет: второй карты
 * доступа в системе не появляется.
 *
 * **Поиск по данным включён только там, где он и так есть** (менеджер и
 * руководитель): палитра зовёт тот же сервис, что и страница поиска, со всеми
 * его скоупами. Клиентским ролям поиск по данным не открываем — их поиск
 * никогда не проектировался, и это отдельный объём безопасности.
 */
export type PaletteSection = { href: string; label: string };

const MIN_QUERY = 2;

export function CommandPalette({
  sections,
  searchEnabled = false,
  searchHref,
  teamModeOverride = false,
}: {
  sections: PaletteSection[];
  /** Есть ли у роли поиск по данным (менеджер, руководитель). */
  searchEnabled?: boolean;
  /** Куда вести за полными результатами. */
  searchHref?: string;
  teamModeOverride?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Ответ поиска хранится вместе с запросом, к которому он относится. Так
   * состояние не нужно «сбрасывать» при каждом нажатии клавиши: пока запрос и
   * ответ не совпали — значит, идёт поиск, и старые находки не показываются.
   */
  const [result, setResult] = useState<{ q: string; groups: SearchGroup[] } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+K на Windows/Linux, ⌘K на Mac — привычная всем комбинация.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const trimmed = query.trim();
  const wantSearch = searchEnabled && trimmed.length >= MIN_QUERY;

  // Поиск по данным — с задержкой: иначе каждый символ уходил бы в базу.
  useEffect(() => {
    if (!wantSearch) return;
    let alive = true;
    const timer = setTimeout(() => {
      void paletteSearchAction(trimmed, teamModeOverride)
        .then((res) => {
          if (!alive) return;
          setResult({ q: trimmed, groups: res.ok ? res.groups.filter((g) => g.hits.length) : [] });
        })
        .catch(() => {
          if (alive) setResult({ q: trimmed, groups: [] });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [trimmed, wantSearch, teamModeOverride]);

  const groups = result?.q === trimmed ? result.groups : null;
  const searching = wantSearch && groups === null;

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => s.label.toLowerCase().includes(q));
  }, [sections, query]);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter ведёт в первый раздел из списка — самый частый случай.
    const first = matched[0];
    if (first) go(first.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-2 text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1 hover:border-[#F97316] transition-colors"
        data-testid="palette-open"
        title="Быстрый переход: Ctrl+K (⌘K на Mac)"
      >
        <span aria-hidden>🔎</span>
        Быстрый переход
        <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">Ctrl K</kbd>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Куда перейти?"
        size="lg"
        closeOnBackdrop
      >
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchEnabled ? 'Раздел, клиент, заказ или человек…' : 'Название раздела…'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#F97316]"
            data-testid="palette-input"
          />

          <div>
            <div className="text-xs text-gray-500 mb-1">Разделы</div>
            {matched.length === 0 ? (
              <p className="text-sm text-gray-500" data-testid="palette-no-sections">
                Разделов с таким названием нет. Попробуйте другое слово.
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto" data-testid="palette-sections">
                {matched.map((s) => (
                  <li key={s.href}>
                    <button
                      type="button"
                      onClick={() => go(s.href)}
                      className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50"
                      data-testid={`palette-section-${s.href}`}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {wantSearch && (
            <div data-testid="palette-data">
              <div className="text-xs text-gray-500 mb-1">Данные</div>
              {searching && <p className="text-sm text-gray-500">Ищем…</p>}
              {groups !== null && groups.length === 0 && (
                <p className="text-sm text-gray-500">
                  Ничего не нашлось — попробуйте другое слово.
                </p>
              )}
              {groups !== null &&
                groups.map((g) => (
                  <div key={g.key} className="mb-2">
                    <div className="text-xs text-gray-400">{g.labelRu}</div>
                    <ul>
                      {g.hits.slice(0, 3).map((h) => (
                        <li key={`${g.key}-${h.href}`}>
                          <button
                            type="button"
                            onClick={() => go(h.href)}
                            className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-gray-50"
                          >
                            {h.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              {searchHref && (
                <button
                  type="button"
                  onClick={() => go(`${searchHref}?q=${encodeURIComponent(trimmed)}`)}
                  className="text-xs text-[#EA580C] hover:underline"
                  data-testid="palette-all-results"
                >
                  Показать все результаты →
                </button>
              )}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}
