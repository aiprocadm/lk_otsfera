import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navByRole } from '@/lib/navigation/cabinet';
import { SECTIONS, type SectionKey } from '@/lib/navigation/sectionLabels';
import { ORG_CARD_TABS } from '@/lib/navigation/orgCardTabs';
import { ORG_CARD_TILES } from '@/lib/navigation/orgCardTiles';

/**
 * Сторож единого названия раздела (`У-106`, `У-108`, §0.2 — правило зеркала).
 *
 * «Один и тот же объект называется одинаково во всех шести кабинетах.»
 *
 * **Что изменилось на этапе 3.** Раньше сторож сравнивал разделы по последнему
 * куску адреса: `/admin/payments-import` и `/manager/payments-import` — один
 * экран. Приём рабочий, но косвенный — это совпадение путей, а не смысла:
 * `/leader/team` и `/manager/team` совпали случайно, а близкие разделы с
 * разными адресами он не сравнивал вовсе. Теперь у пункта меню есть **ключ
 * раздела**, и сравнение идёт по нему.
 *
 * Главная проверка здесь — не равенство строк (оно теперь выполняется по
 * построению), а то, что **обойти словарь нельзя**: пункт меню не имеет права
 * нести своё название.
 */
const SRC = join(__dirname, '..');

describe('один раздел — одно название (У-106)', () => {
  const items = Object.entries(navByRole).flatMap(([role, list]) =>
    list.map((i) => ({ role, ...i }))
  );

  it('реестр разобран — есть что проверять', () => {
    expect(items.length).toBeGreaterThan(80);
  });

  it('пункт меню не носит своего названия — оно приходит из словаря', () => {
    // Это и есть механизм: пока названия нет в реестре, разъехаться ему негде.
    // Ищем ГДЕ УГОДНО в строке, а не с её начала: однострочный пункт
    // `{ href: '…', sectionKey: '…', label: '…' }` — самый вероятный вид
    // регресса, и якорь `^\s*` его пропускал (проверено мутацией, §16).
    const src = readFileSync(join(SRC, 'lib/navigation/cabinet.ts'), 'utf8');
    expect(src).not.toMatch(/\blabel:\s*'/);
    expect(src).not.toMatch(/\biconKey:\s*'/);
  });

  it('одинаковый ключ ⇒ одинаковые название и значок в любой роли', () => {
    for (const item of items) {
      const meta = SECTIONS[item.sectionKey];
      expect(meta, `${item.role}: неизвестный ключ ${item.sectionKey}`).toBeDefined();
      expect(item.label, `${item.role} ${item.href}`).toBe(meta.label);
      expect(item.iconKey, `${item.role} ${item.href}`).toBe(meta.iconKey);
    }
  });

  it('два ключа не делят одно название', () => {
    // Иначе «Заказы» окажется двумя разными разделами, и человек не поймёт, о
    // каком из них речь.
    const byLabel = new Map<string, SectionKey[]>();
    for (const [key, meta] of Object.entries(SECTIONS) as [SectionKey, { label: string }][]) {
      byLabel.set(meta.label, [...(byLabel.get(meta.label) ?? []), key]);
    }
    const dup = [...byLabel.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([label, keys]) => `«${label}» → ${keys.join(', ')}`);
    expect(dup, 'одно название на несколько ключей раздела').toEqual([]);
  });

  it('`У-107`: дореформенных названий в словаре не осталось', () => {
    const labels = Object.values(SECTIONS).map((s) => s.label);
    for (const old of [
      'Комиссии',
      'Корректировки',
      'Загрузка из 1С',
      'Импорт оплат',
      'Доп-поля',
      'Роли',
      'Воронка',
      'Здоровье',
      'Доступ к ПДн',
      'Синхронизация (авто)',
    ]) {
      expect(labels, `осталось старое название «${old}»`).not.toContain(old);
    }
  });
});

/**
 * `У-108`: тот же сторож покрывает вкладки карточки организации и плитки.
 * Названия вкладок живут в своём реестре — механизм должен не дать им
 * разъехаться с названиями разделов.
 */
describe('вкладки карточки не расходятся с разделами (У-108)', () => {
  it('вкладка с ключом раздела называется и рисуется так же, как раздел', () => {
    for (const tab of ORG_CARD_TABS) {
      const meta = SECTIONS[tab.key as SectionKey];
      if (!meta) continue; // вкладки без одноимённого раздела — «Обзор», «Сотрудники», «Комментарии»
      expect(tab.label, `вкладка ${tab.key}`).toBe(meta.label);
      expect(tab.iconKey, `вкладка ${tab.key}`).toBe(meta.iconKey);
    }
  });

  it('одинаковое название ⇒ одинаковый значок, даже если это раздел и вкладка', () => {
    // Ловит расхождение вида «Входящие письма» пунктом меню с одним значком и
    // вкладкой карточки — с другим.
    const byLabel = new Map<string, Set<string>>();
    for (const meta of Object.values(SECTIONS)) {
      byLabel.set(meta.label, new Set([...(byLabel.get(meta.label) ?? []), meta.iconKey]));
    }
    for (const tab of ORG_CARD_TABS) {
      byLabel.set(tab.label, new Set([...(byLabel.get(tab.label) ?? []), tab.iconKey]));
    }
    const broken = [...byLabel.entries()]
      .filter(([, icons]) => icons.size > 1)
      .map(([label, icons]) => `«${label}» → ${[...icons].join(', ')}`);
    expect(broken, 'один и тот же раздел нарисован разными значками').toEqual([]);
  });

  it('подписи плиток заданы один раз и не пустые', () => {
    const labels = ORG_CARD_TILES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
  });
});
