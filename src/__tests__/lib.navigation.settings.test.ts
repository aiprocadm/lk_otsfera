import { describe, it, expect } from 'vitest';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  legacyRedirectMap,
  sectionByPath,
  sectionsForCabinet,
  settingsHref,
  settingsRoot,
  settingsSectionHref,
} from '@/lib/navigation/settings';

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

  it('карта редиректов покрывает все девять разделов из ТЗ', () => {
    const map = legacyRedirectMap();
    expect(Object.fromEntries(map)).toEqual({
      '/admin/health': '/admin/settings/system/health',
      '/admin/integrations': '/admin/settings/integrations',
      '/admin/sync': '/admin/settings/integrations/1c/auto',
      '/admin/import': '/admin/settings/integrations/1c/excel',
      '/admin/payments-import': '/admin/settings/integrations/1c/payments',
      // Этап 7 ТЗ импорта: старые адреса менеджерского кабинета уводят
      // руководителя в ЕГО хаб (явный cabinet в LegacyRoute).
      '/manager/import': '/leader/settings/integrations/1c/excel',
      '/manager/payments-import': '/leader/settings/integrations/1c/payments',
      '/admin/roles': '/admin/settings/access/roles',
      '/leader/roles': '/leader/settings/access/roles',
      '/admin/order-statuses': '/admin/settings/catalogs/application-statuses',
      '/leader/settings/order-statuses': '/leader/settings/catalogs/application-statuses',
      '/admin/custom-fields': '/admin/settings/catalogs/custom-fields',
      '/leader/settings/custom-fields': '/leader/settings/catalogs/custom-fields',
      '/admin/pii-access': '/admin/settings/security/personal-data',
      '/admin/audit': '/admin/settings/security/audit',
    });
  });

  it('старые пути не повторяются между разделами', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => s.legacyHrefs.map((l) => l.from));
    expect(new Set(all).size).toBe(all.length);
  });

  it('leader-путь редиректит в leader-хаб, admin-путь — в админский, manager-путь — к руководителю', () => {
    for (const [from, to] of legacyRedirectMap()) {
      // Пути менеджерского кабинета — исключение с явным cabinet: 'leader'
      // (этап 7 ТЗ импорта); остальные кабинеты выводятся из префикса.
      const cabinet =
        from.startsWith('/leader') || from.startsWith('/manager') ? '/leader' : '/admin';
      expect(to.startsWith(`${cabinet}/settings/`)).toBe(true);
    }
  });
});
