import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { INBOUND_SECTION_LINE } from '@/lib/help/inboundSections';

/**
 * СТРАЖ `У-349` (этап 4 ТЗ 28.10.2026, РК «Обращения»): тестировщик написал,
 * что «Обращения» потеряли смысл рядом с «Входящими обращениями». Разделы
 * разные (`Р-7-6`), но подзаголовки этого не объясняли — шесть экранов, шесть
 * формулировок, ни одна не называла соседний раздел.
 *
 * Держим две вещи: (1) подзаголовок каждого из шести экранов берётся из
 * `INBOUND_SECTION_LINE`, а не пишется руками; (2) каждая строка называет
 * соседний раздел — иначе разница снова не видна.
 *
 * Мутации (проверено 31.10.2026): вернуть руками написанный подзаголовок на
 * `/leader/requests` → красная первая проверка; убрать «Входящих обращениях» из
 * строки `requests` → красная вторая.
 */

const APP = join(__dirname, '..', 'app');
const CABINETS = ['admin', 'leader', 'manager'] as const;

describe('подзаголовки «Обращений» и «Входящих обращений» (`У-349`)', () => {
  for (const cabinet of CABINETS) {
    for (const section of ['requests', 'intake'] as const) {
      it(`/${cabinet}/${section} — подзаголовок из общего источника`, () => {
        const src = readSource(join(APP, cabinet, section, 'page.tsx'));
        expect(src).toContain(`subtitle={INBOUND_SECTION_LINE.${section}}`);
        expect(src).not.toMatch(/<PageHeader[^>]*subtitle="/);
      });
    }
  }

  it('каждая строка называет соседний раздел', () => {
    expect(INBOUND_SECTION_LINE.requests).toContain('«Входящих обращениях»');
    expect(INBOUND_SECTION_LINE.intake).toContain('«Обращения»');
  });

  it('граница по `Р-7-6`: форма — в «Обращениях», чат кабинета — во «Входящих»', () => {
    expect(INBOUND_SECTION_LINE.requests).toMatch(/форму обращения/);
    expect(INBOUND_SECTION_LINE.intake).toMatch(/чата кабинета/);
  });
});
