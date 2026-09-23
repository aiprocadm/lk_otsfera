/**
 * `У-253` — разбор фильтров экрана «Документы» из адресной строки.
 *
 * Правило проекта: чужое слово в адресе — это «без фильтра», а не ошибка.
 * Человек, поправивший адрес руками, должен увидеть список, а не отказ.
 */
import { describe, it, expect } from 'vitest';
import {
  parseStaffDocumentFilters,
  documentYearOptions,
  DOCUMENT_STATUS_FILTER_OPTIONS,
  DOCUMENT_DIRECTION_FILTER_OPTIONS,
} from '@/lib/documents/listFilters';

describe('parseStaffDocumentFilters', () => {
  it('пустой адрес — ни одного фильтра', () => {
    expect(parseStaffDocumentFilters({})).toEqual({
      year: undefined,
      direction: undefined,
      status: undefined,
      source: undefined,
    });
  });

  it('разбирает все четыре фильтра', () => {
    expect(
      parseStaffDocumentFilters({
        year: '2026',
        direction: 'incoming',
        status: 'sent',
        source: 'one_c',
      })
    ).toEqual({ year: 2026, direction: 'incoming', status: 'sent', source: 'one_c' });
  });

  it('мусор в адресе означает «без фильтра», а не отказ', () => {
    expect(
      parseStaffDocumentFilters({
        year: 'позавчера',
        direction: 'вбок',
        status: 'какой-то',
        source: 'из воздуха',
      })
    ).toEqual({
      year: undefined,
      direction: undefined,
      status: undefined,
      source: undefined,
    });
  });

  it('невозможный год отбрасывается', () => {
    expect(parseStaffDocumentFilters({ year: '1800' }).year).toBeUndefined();
    expect(parseStaffDocumentFilters({ year: '3000' }).year).toBeUndefined();
    expect(parseStaffDocumentFilters({ year: '2026.5' }).year).toBeUndefined();
  });
});

describe('documentYearOptions', () => {
  it('считаются от «сейчас», а не прописаны навсегда', () => {
    // Захардкоженный список молча устареет 1 января, и документы нового года
    // станет нечем отобрать.
    const years = documentYearOptions(new Date('2026-09-18T00:00:00Z'));
    expect(years[0]).toBe(2026);
    expect(years).toContain(2021);
    expect(years).toHaveLength(6);
  });

  it('прогон №36: 1 января в 00:30 по Москве наступивший год уже в списке', () => {
    // По Гринвичу это ещё 31.12.2025 21:30: `getFullYear()` на сервере (UTC)
    // отдавал 2025, и документы, выпущенные в первые часы года, нечем было
    // отобрать. Год выборки (`moscowYearRange`) — тоже московский.
    const years = documentYearOptions(new Date('2025-12-31T21:30:00Z'));
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(2021);
  });
});

describe('списки фильтров', () => {
  it('у каждого состояния и направления есть русская подпись', () => {
    for (const opt of [...DOCUMENT_STATUS_FILTER_OPTIONS, ...DOCUMENT_DIRECTION_FILTER_OPTIONS]) {
      expect(opt.label.length, `«${opt.value}» без подписи`).toBeGreaterThan(2);
      expect(/[а-яё]/i.test(opt.label), `«${opt.value}» подписан не по-русски`).toBe(true);
    }
  });

  it('значения не повторяются', () => {
    const values = DOCUMENT_STATUS_FILTER_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
