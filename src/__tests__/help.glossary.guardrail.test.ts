import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY, REQUIRED_TERMS } from '@/lib/help/glossary';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Словарь терминов (`У-76`, этап 9).
 *
 * Страж существует потому, что источников смысла два: `docs/glossary.md` для
 * разработчиков и этот реестр для пользователей. Разъехавшийся словарь хуже
 * отсутствующего — человек прочитает одно, а в интерфейсе увидит другое.
 */
describe('словарь терминов (У-76)', () => {
  const terms = GLOSSARY.flatMap((s) => s.terms.map((t) => t.term));

  it('шесть терминов из ТЗ есть в словаре кабинета', () => {
    for (const required of REQUIRED_TERMS) {
      expect(terms, `«${required}» обязателен по У-76`).toContain(required);
    }
  });

  it('те же шесть терминов есть и в docs/glossary.md — источники не разъехались', () => {
    const md = readFileSync(join(process.cwd(), 'docs/glossary.md'), 'utf8');
    for (const required of REQUIRED_TERMS) {
      // В документе термины стоят в единственном числе в таблицах; сверяем
      // корень, чтобы «Обращение»/«Обращения» считались одним словом.
      const root = required.replace(/[ае]$/u, '');
      expect(md, `«${required}» пропал из docs/glossary.md`).toContain(root);
    }
  });

  it('каждый термин объяснён, а не назван', () => {
    for (const section of GLOSSARY) {
      expect(section.intro.length, `${section.title}: нужен подзаголовок (§15)`).toBeGreaterThan(
        10
      );
      for (const t of section.terms) {
        // Одно слово вместо объяснения — это не словарь, а оглавление.
        expect(t.meaning.length, `«${t.term}»: объяснение слишком короткое`).toBeGreaterThan(30);
      }
    }
  });

  it('термины не дублируются внутри одного раздела', () => {
    for (const section of GLOSSARY) {
      const inSection = section.terms.map((t) => t.term);
      expect(new Set(inSection).size, `${section.title}: повтор термина`).toBe(inSection.length);
    }
  });

  it('ссылка «Справка» есть в подвале меню всех шести кабинетов', () => {
    for (const role of [
      'admin',
      'manager',
      'leader',
      'partner',
      'organization',
      'student',
    ] as const) {
      const item = navByRole[role].find((i) => i.href === '/help');
      expect(item, `у роли ${role} нет ссылки на словарь`).toBeTruthy();
      expect(item?.label).toBe('Справка');
      // Подвал, а не середина списка: это служебная ссылка, не рабочий раздел.
      expect(item?.pinnedBottom, `у роли ${role} «Справка» не закреплена внизу`).toBe(true);
    }
  });

  it('словарь не гейтится флагом — он одинаков для всех и всегда', () => {
    for (const role of [
      'admin',
      'manager',
      'leader',
      'partner',
      'organization',
      'student',
    ] as const) {
      expect(navByRole[role].find((i) => i.href === '/help')?.flag).toBeUndefined();
    }
  });
});
