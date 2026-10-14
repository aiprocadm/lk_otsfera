import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MentionText } from '@/components/ui/mention-text';

/**
 * `MentionText` (`У-282`): выделение «@Имя» в тексте. Правило совпадения —
 * то же, что у серверного `extractMentions`: имя целиком, без учёта регистра,
 * дальше не буква и не цифра; длинные имена раньше коротких.
 */
function html(text: string, names: string[]): string {
  return renderToStaticMarkup(React.createElement(MentionText, { text, names }));
}

describe('MentionText', () => {
  it('выделяет имя коллеги, остальной текст — как есть', () => {
    const out = html('Привет, @Анна Смирнова, глянь', ['Анна Смирнова']);
    expect(out).toContain('>@Анна Смирнова</span>');
    expect(out.startsWith('Привет, ')).toBe(true);
    expect(out.endsWith(', глянь')).toBe(true);
  });

  it('длинное имя важнее короткого: «@Анна Смирнова» не режется до «@Анна»', () => {
    const out = html('@Анна Смирнова', ['Анна', 'Анна Смирнова']);
    expect(out).toContain('>@Анна Смирнова</span>');
    expect(out.match(/<span/g)).toHaveLength(1);
  });

  it('регистр не важен — как на сервере', () => {
    expect(html('@анна смирнова', ['Анна Смирнова'])).toContain('>@анна смирнова</span>');
  });

  it('часть слова не выделяется: «@Иван Петровский» — не упоминание «Иван Петров»', () => {
    expect(html('@Иван Петровский', ['Иван Петров'])).not.toContain('<span');
  });

  it('несколько упоминаний и пустой список имён', () => {
    expect(html('@Иван и @Анна', ['Иван', 'Анна']).match(/<span/g)).toHaveLength(2);
    expect(html('@Иван', [])).toBe('@Иван');
    expect(html('@Иван', ['  '])).toBe('@Иван');
  });
});
