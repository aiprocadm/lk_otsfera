/**
 * Движок подстановок (`У-160`, вынесен из реестра писем `У-128`).
 *
 * Проверяем механику и ровно одно продуктовое правило: движок НЕ решает, что
 * делать с пустым значением. Прочерки — дело вызывающего: в письме «Заказ —»
 * читается нормально, а в договоре «действует до —» означало бы бумагу без
 * срока.
 */
import { describe, it, expect } from 'vitest';
import {
  applyPlaceholders,
  extractPlaceholders,
  findMissingPlaceholders,
  findUnknownPlaceholders,
} from '@/lib/templates/placeholders';

describe('extractPlaceholders', () => {
  it('находит подстановки, терпит пробелы внутри скобок и возвращает повторы', () => {
    expect(extractPlaceholders('{{a}} и {{ b }} и снова {{a}}')).toEqual(['a', 'b', 'a']);
  });

  it('текст без подстановок даёт пустой список', () => {
    expect(extractPlaceholders('обычный текст {не подстановка}')).toEqual([]);
  });
});

describe('findUnknownPlaceholders', () => {
  it('пропускает известные и называет каждую неизвестную по одному разу', () => {
    expect(findUnknownPlaceholders(['a', 'b'], '{{a}} {{b}}')).toEqual({ ok: true });
    expect(findUnknownPlaceholders(['a'], '{{a}} {{x}} {{x}} {{y}}')).toEqual({
      ok: false,
      unknown: ['x', 'y'],
    });
  });

  it('проверяет несколько текстов сразу — опечатка в любом из них не проскочит', () => {
    expect(findUnknownPlaceholders(['a'], '{{a}}', '{{нет}}')).toEqual({
      ok: false,
      unknown: ['нет'],
    });
  });
});

describe('findMissingPlaceholders', () => {
  it('обязательная подстановка на месте — норма; выброшенная — ошибка', () => {
    expect(findMissingPlaceholders(['term'], 'действует {{term}}')).toEqual({ ok: true });
    expect(findMissingPlaceholders(['term'], 'действует бессрочно')).toEqual({
      ok: false,
      missing: ['term'],
    });
  });

  it('без обязательных подстановок проверять нечего', () => {
    expect(findMissingPlaceholders([], 'любой текст')).toEqual({ ok: true });
  });
});

describe('applyPlaceholders', () => {
  it('подставляет значения по карте, включая повторы одной подстановки', () => {
    const values = new Map([['name', 'ООО «Ромашка»']]);
    expect(applyPlaceholders('{{name}} и ещё раз {{ name }}', values)).toBe(
      'ООО «Ромашка» и ещё раз ООО «Ромашка»'
    );
  });

  it('незнакомую подстановку оставляет видимой, а не съедает', () => {
    // Пропажа куска текста хуже видимой опечатки: её человек заметит.
    expect(applyPlaceholders('до {{нет}} после', new Map())).toBe('до {{нет}} после');
  });

  it('пустую строку подставляет как есть — прочерки не его дело', () => {
    expect(applyPlaceholders('срок: {{term}}', new Map([['term', '']]))).toBe('срок: ');
  });
});
