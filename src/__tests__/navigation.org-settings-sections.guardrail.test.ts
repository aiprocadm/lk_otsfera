import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORG_SETTINGS_SECTIONS,
  orgSettingsSectionsFor,
} from '@/lib/navigation/orgSettingsSections';

/**
 * Страж вкладки «Настройки» карточки организации (`У-99`, правило зеркала
 * §0.2 ТЗ).
 *
 * Ловит ровно ту поломку, из-за которой требование и появилось: один и тот же
 * набор настроек назывался и лежал в каждом кабинете по-своему — «Реквизиты»
 * против «Реквизиты организации», «Доступ в кабинет» против «Доступ
 * заказчика», ставка то до реквизитов, то после. Пока состав берётся из
 * реестра, разъехаться нельзя; страж следит, чтобы реестр не обошли.
 */
const SRC = join(process.cwd(), 'src');

describe('реестр секций «Настройки» (У-99)', () => {
  it('ключи уникальны, названия и пояснения заполнены', () => {
    const keys = ORG_SETTINGS_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of ORG_SETTINGS_SECTIONS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      // §15: «что здесь делают» — подзаголовок в одну строку простыми словами.
      expect(s.description.trim().length).toBeGreaterThan(0);
      expect(s.cabinets.length).toBeGreaterThan(0);
    }
  });

  it('порядок секций одинаков во всех кабинетах — кабинет только сужает набор', () => {
    const order = ORG_SETTINGS_SECTIONS.map((s) => s.key);
    for (const cabinet of ['admin', 'leader', 'manager', 'partner', 'organization'] as const) {
      const own = orgSettingsSectionsFor(cabinet).map((s) => s.key);
      // Подмножество реестра…
      expect(own.every((k) => order.includes(k))).toBe(true);
      // …и в том же относительном порядке.
      expect(own).toEqual(order.filter((k) => own.includes(k)));
    }
  });

  it('одинаковый ключ ⇒ одинаковое название в любом кабинете', () => {
    const byKey = new Map(ORG_SETTINGS_SECTIONS.map((s) => [s.key, s.title]));
    for (const cabinet of ['admin', 'leader', 'manager', 'partner', 'organization'] as const) {
      for (const s of orgSettingsSectionsFor(cabinet)) {
        expect(s.title).toBe(byKey.get(s.key));
      }
    }
  });

  it('реквизиты и доступ в кабинет положены каждому кабинету', () => {
    for (const cabinet of ['admin', 'leader', 'manager', 'partner', 'organization'] as const) {
      const keys = orgSettingsSectionsFor(cabinet).map((s) => s.key);
      expect(keys).toContain('requisites');
      expect(keys).toContain('cabinetAccess');
    }
  });

  it('заказчику не показывают ни ставку комиссии, ни менеджеров', () => {
    const keys = orgSettingsSectionsFor('organization').map((s) => s.key);
    expect(keys).not.toContain('commission');
    expect(keys).not.toContain('managers');
  });

  it('партнёр видит ставку, но формы правки у него нет (У-3, решение Р-4)', () => {
    expect(orgSettingsSectionsFor('partner').map((s) => s.key)).toContain('commission');
    // Форма правки ставки — только на страницах сотрудников ЦО. Партнёрский
    // экран настроек организации её не импортирует, и это должно оставаться
    // проверяемым фактом, а не обещанием в комментарии.
    const partnerSettings = readFileSync(
      join(SRC, 'app/partner/portfolio/[orgId]/settings/page.tsx'),
      'utf8'
    );
    expect(partnerSettings).not.toContain('AdminRateOverrideForm');
  });

  it('старые подписи пользователей кабинета в интерфейсе не воскресают (У-98)', () => {
    // Тот же объект звали «Доступ заказчика» и «Пользователи». Одно название —
    // одно место (§0.2); реестр обязан нести именно его.
    const titles = ORG_SETTINGS_SECTIONS.map((s) => s.title);
    expect(titles).toContain('Доступ в кабинет');
    expect(titles).not.toContain('Доступ заказчика');
    expect(titles).not.toContain('Команда');
  });
});
