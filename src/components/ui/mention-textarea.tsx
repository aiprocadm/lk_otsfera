'use client';
import React, { useState } from 'react';

export type MentionOption = { id: string; name: string };

/** Токен после `@` под кареткой, или null, если каретка не внутри упоминания. */
function mentionToken(value: string, caret: number): string | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const token = upto.slice(at + 1);
  if (/\s/.test(token)) return null;
  return token;
}

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** Кого можно упомянуть — список коллег, уже отобранный сервером. */
  colleagues: MentionOption[];
  /** Внешний ref на textarea — для фокуса после отправки (чат команды). */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null> | undefined;
};

/**
 * Поле с подсказкой имён после `@` (этап 1 ТЗ 12.09.2026, `У-183`; извлечено
 * из композитора чата команды, поведение то же): пока каретка стоит внутри
 * `@токена`, над полем список коллег, чьё имя начинается с токена; выбор
 * подставляет `@Имя ` и возвращает каретку за ним. Никакой библиотеки — простой
 * управляемый матч (M4 §2.5).
 */
export function MentionTextarea({ value, onChange, colleagues, textareaRef, ...rest }: Props) {
  const localRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;
  const [rawQuery, setQuery] = useState<string | null>(null);
  // Внешний сброс текста (отправили, отменили) закрывает список: пустое поле
  // не может содержать `@токен`, поэтому запрос выводится, а не хранится.
  const query = value ? rawQuery : null;

  const filtered =
    query === null
      ? []
      : colleagues.filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()));
  const show = query !== null && filtered.length > 0;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    setQuery(mentionToken(e.target.value, e.target.selectionStart));
  }

  function insert(name: string) {
    const el = ref.current;
    // Список рисуется только после монтирования поля — ref к этому моменту есть.
    /* v8 ignore next -- защитная ветка: ref не бывает null при клике по подсказке */
    if (!el) return;
    const caret = el.selectionStart;
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    // Каретку могли переставить ПЕРЕД `@` при открытом списке — подставлять некуда.
    if (at === -1) return;
    const before = value.slice(0, at);
    const after = value.slice(caret);
    const insertion = `@${name} `;
    onChange(before + insertion + after);
    setQuery(null);
    const pos = before.length + insertion.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      {show && (
        <ul
          role="listbox"
          aria-label="Кого упомянуть"
          className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => insert(c.name)}
                className="w-full px-3 py-2 text-left text-sm text-[#111111] hover:bg-gray-50"
              >
                @{c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea ref={ref} value={value} onChange={handleChange} {...rest} />
    </div>
  );
}
