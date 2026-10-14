import React from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Текст с выделенными упоминаниями «@Имя Фамилия» (`У-282`, `Д-57`).
 *
 * Без выделения упоминание выглядело как обычный текст, и человек не мог
 * понять, сработало ли оно. Правило совпадения — то же, что у сервера
 * (`extractMentions`): имя целиком, без учёта регистра, дальше — не буква и не
 * цифра; длинные имена раньше коротких, чтобы «@Анна Петрова» не стала «@Анна».
 */
export function MentionText({ text, names }: { text: string; names: readonly string[] }) {
  const sorted = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (sorted.length === 0) return <>{text}</>;
  const re = new RegExp(`@(${sorted.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <span key={at} className="rounded bg-orange-50 px-0.5 font-medium text-[#EA580C]">
        {m[0]}
      </span>
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
