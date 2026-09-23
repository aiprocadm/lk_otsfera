import { describe, it, expect } from 'vitest';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  sectionByPath,
  sectionsForCabinet,
  settingsHref,
  settingsRoot,
  settingsSectionHref,
} from '@/lib/navigation/settings';
import { REMOVED_PATHS } from '@/lib/navigation/removedPaths';

/**
 * Реестр разделов — единственный источник правды для хаба «Настройки»
 * (ТЗ 2026-08-04). Тест держит его инварианты: без дублей, каждый раздел в
 * известной группе и хотя бы в одном кабинете, старые пути ведут туда, куда
 * обещает ТЗ раздел 2.
 */
describe('реестр разделов настроек', () => {
  it('id и path уникальны', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    const paths = SETTINGS_SECTIONS.map((s) => s.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('каждый раздел — в известной группе и хотя бы в одном кабинете', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const section of SETTINGS_SECTIONS) {
      expect(groupIds.has(section.group)).toBe(true);
      expect(section.cabinets.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it('в каждой группе есть хотя бы один раздел', () => {
    for (const group of SETTINGS_GROUPS) {
      expect(SETTINGS_SECTIONS.some((s) => s.group === group.id)).toBe(true);
    }
  });

  it('settingsRoot и settingsHref собирают путь по кабинету', () => {
    const roles = SETTINGS_SECTIONS.find((s) => s.id === 'access.roles');
    expect(settingsRoot('admin')).toBe('/admin/settings');
    expect(settingsRoot('leader')).toBe('/leader/settings');
    expect(settingsHref(roles!, 'admin')).toBe('/admin/settings/access/roles');
    expect(settingsHref(roles!, 'leader')).toBe('/leader/settings/access/roles');
  });

  it('settingsSectionHref: адрес раздела по id, null — у кабинета раздела нет (У-169)', () => {
    expect(settingsSectionHref('catalogs.requisites', 'admin')).toBe(
      '/admin/settings/catalogs/requisites'
    );
    expect(settingsSectionHref('catalogs.requisites', 'leader')).toBe(
      '/leader/settings/catalogs/requisites'
    );
    // У менеджера хаба настроек нет — ссылка вела бы в 403.
    expect(settingsSectionHref('catalogs.requisites', 'manager')).toBeNull();
    // Раздел только админа у руководителя не появляется.
    expect(settingsSectionHref('system.health', 'leader')).toBeNull();
    expect(settingsSectionHref('no.such.section', 'admin')).toBeNull();
  });

  it('sectionsForCabinet отдаёт только разделы своего кабинета', () => {
    const leader = sectionsForCabinet('leader').map((s) => s.id);
    expect(leader).toContain('access.roles');
    expect(leader).toContain('catalogs.customFields');
    expect(leader).not.toContain('security.audit');
    expect(leader).not.toContain('system.health');
  });

  it('sectionByPath находит раздел, в том числе по вложенной вкладке', () => {
    // `У-46` (этап 7): «Синхронизация» больше не отдельный раздел — она стала
    // вкладкой «Обмена с 1С», поэтому её путь резолвится в него.
    expect(sectionByPath('admin', '/admin/settings/integrations/1c/auto')?.id).toBe(
      'integrations.oneC'
    );
    // Самое длинное совпадение: 1c/excel — это «Обмен с 1С», а не «Интеграции».
    expect(sectionByPath('admin', '/admin/settings/integrations/1c/excel')?.id).toBe(
      'integrations.oneC'
    );
    expect(sectionByPath('admin', '/admin/settings/integrations')?.id).toBe(
      'integrations.overview'
    );
    expect(sectionByPath('leader', '/leader/settings/access/roles')?.id).toBe('access.roles');
  });

  it('корень хаба и чужой кабинет разделом не считаются', () => {
    expect(sectionByPath('admin', '/admin/settings')).toBeUndefined();
    expect(sectionByPath('leader', '/admin/settings/security/audit')).toBeUndefined();
    // Аудита нет в кабинете руководителя — путь не должен ни с чем совпасть.
    expect(sectionByPath('leader', '/leader/settings/security/audit')).toBeUndefined();
  });

  it('удалённый адрес хаба подсказывает живой раздел реестра (У-263)', () => {
    // Карты редиректов больше нет: шлюзы удалены (прогон сопровождения №37).
    // Остался замороженный список удалённых адресов с подсказкой «где теперь»
    // — она обязана вести в существующий раздел, иначе страж ссылок отправит
    // человека по неверной подсказке.
    const inHub = REMOVED_PATHS.filter((r) => /^\/(admin|leader)\/settings\//.test(r.movedTo));
    expect(inHub.length).toBeGreaterThan(15);
    for (const { path, movedTo } of inHub) {
      const cabinet = movedTo.startsWith('/leader') ? 'leader' : 'admin';
      const section = sectionByPath(cabinet, movedTo.split('?')[0] ?? movedTo);
      expect(section, `${path} → ${movedTo}: такого раздела нет`).toBeDefined();
    }
  });
});
