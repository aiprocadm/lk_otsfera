'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Автокомплит организации по названию/ИНН через серверный DaData-прокси
 * (этап 5 PR-2, ФТ-13.3). Строго презентационный и domain-agnostic —
 * сознательно общий для клиентских и staff-форм (исключение из
 * sibling-паттерна §4): никакой доменной логики, только текстовый ввод +
 * подсказки. Пустой ответ / выключенная интеграция / сбой сети → просто нет
 * выпадашки, форма деградирует до ручного ввода без сообщений об ошибке.
 */

export type PartyAutocompleteSuggestion = {
  name: string;
  inn: string;
  kpp: string | null;
  ogrn: string | null;
  address: string | null;
};

export type PartyAutocompleteProps = {
  value: string;
  onChange: (text: string) => void;
  onSelect: (suggestion: PartyAutocompleteSuggestion) => void;
  placeholder?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Пробрасываются на input, чтобы компонент вставал в существующие формы. */
  id?: string;
  name?: string;
  required?: boolean;
  maxLength?: number;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const BLUR_CLOSE_DELAY_MS = 120;
// Как инпуты соседних форм: border-gray-200 + оранжевый focus-ring.
const DEFAULT_INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50';

export function PartyAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  inputClassName,
  disabled,
  id,
  name,
  required,
  maxLength,
}: PartyAutocompleteProps) {
  const reactId = useId();
  const listId = `${id ?? reactId}-listbox`;
  const [suggestions, setSuggestions] = useState<PartyAutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Отсекает поздние ответы: рендерим только результат последнего запроса.
  const requestSeqRef = useRef(0);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurRef.current) clearTimeout(blurRef.current);
    },
    []
  );

  function scheduleFetch(text: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = text.trim();
    if (query.length < MIN_QUERY_LEN) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      closeList();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async-колбэк setTimeout (debounce): ошибки пойманы try/catch внутри, возврат не используется
    debounceRef.current = setTimeout(async () => {
      const seq = ++requestSeqRef.current;
      try {
        const res = await fetch(`/api/suggest/party?query=${encodeURIComponent(query)}`);
        const body = res.ok
          ? ((await res.json()) as { suggestions?: PartyAutocompleteSuggestion[] })
          : { suggestions: [] };
        if (seq !== requestSeqRef.current) return;
        const next = Array.isArray(body.suggestions) ? body.suggestions : [];
        setSuggestions(next);
        setOpen(next.length > 0);
        setActiveIndex(-1);
      } catch {
        // Сбой сети/парсинга → тихая деградация до ручного ввода.
        if (seq !== requestSeqRef.current) return;
        setSuggestions([]);
        closeList();
      }
    }, DEBOUNCE_MS);
  }

  function select(suggestion: PartyAutocompleteSuggestion) {
    onSelect(suggestion);
    setSuggestions([]);
    closeList();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        select(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeList();
    }
  }

  function onBlur() {
    // Задержка, чтобы успел отработать клик по пункту списка.
    blurRef.current = setTimeout(closeList, BLUR_CLOSE_DELAY_MS);
  }

  function onFocus() {
    if (blurRef.current) clearTimeout(blurRef.current);
    if (suggestions.length > 0) setOpen(true);
  }

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
        }
        autoComplete="off"
        id={id}
        name={name}
        required={required}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          scheduleFetch(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        className={cn(DEFAULT_INPUT_CLASS, inputClassName)}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.inn}-${s.kpp ?? ''}-${i}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={cn('cursor-pointer px-3 py-2', i === activeIndex && 'bg-orange-50')}
              onMouseDown={(e) => {
                // preventDefault держит фокус на инпуте: blur-закрытие не съест клик.
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <div className="text-sm text-[#111111]">{s.name}</div>
              <div className="text-xs text-gray-500">
                ИНН {s.inn}
                {s.address ? ` · ${s.address}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
