import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { quickTasksFor, type QuickTasksRole } from '@/lib/quickTasks';
import { navByRole } from '@/lib/navigation/cabinet';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

/**
 * «Частые задачи» (`У-71`).
 *
 * Главное, что здесь проверяется, — плитка не должна вести в никуда. Раздел
 * может быть выключен флагом, переименован или удалён; блок «что делать
 * дальше», ведущий в 404, хуже отсутствующего блока.
 */
const ROLES: QuickTasksRole[] = ['admin', 'manager', 'leader', 'partner', 'organization'];
const ENV_KEYS = FEATURE_FLAGS.map((f) => `FEATURE_${f.toUpperCase()}`);
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    process.env[k] = '1'; // все разделы включены — максимальный состав плиток
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('quickTasksFor (У-71)', () => {
  it('у каждой роли 4–6 плиток — как требует ТЗ', () => {
    for (const role of ROLES) {
      const tasks = quickTasksFor(role);
      expect(tasks.length, `${role}: слишком мало плиток`).toBeGreaterThanOrEqual(4);
      expect(tasks.length, `${role}: слишком много плиток`).toBeLessThanOrEqual(6);
    }
  });

  it('каждая плитка объясняет, что произойдёт, а не просто называет раздел', () => {
    for (const role of ROLES) {
      for (const t of quickTasksFor(role)) {
        expect(t.title.length, `${role}/${t.href}: пустой заголовок`).toBeGreaterThan(3);
        expect(t.hint.length, `${role}/${t.href}: нет пояснения`).toBeGreaterThan(10);
      }
    }
  });

  it('плитки не дублируются внутри роли', () => {
    for (const role of ROLES) {
      const hrefs = quickTasksFor(role).map((t) => t.href);
      expect(new Set(hrefs).size, `${role}: повтор ссылки`).toBe(hrefs.length);
    }
  });

  it('каждая ссылка ведёт в живой раздел своей роли, а не в никуда', () => {
    for (const role of ROLES) {
      // Реестр меню роли — источник правды о существующих разделах. Ссылка
      // может быть вложенной («/leader/settings/integrations/1c»), поэтому
      // считаем её живой, если она начинается с известного пункта меню.
      const known = navByRole[role].map((i) => i.href);
      for (const t of quickTasksFor(role)) {
        const ok = known.some((href) => t.href === href || t.href.startsWith(`${href}/`));
        expect(ok, `${role}: плитка ${t.href} не соответствует ни одному пункту меню`).toBe(true);
      }
    }
  });

  it('выключенный флагом раздел исчезает из плиток вместе с самим разделом', () => {
    process.env.FEATURE_ENROLLMENT_REQUESTS = '0';
    for (const role of ['partner', 'organization'] as const) {
      const hrefs = quickTasksFor(role).map((t) => t.href);
      expect(hrefs, `${role}: заявки выключены, а плитка осталась`).not.toContain(
        `/${role}/enrollments`
      );
      // Блок не должен схлопнуться: остальные задачи на месте.
      expect(hrefs.length).toBeGreaterThanOrEqual(4);
    }

    process.env.FEATURE_INTAKE_INBOX = '0';
    expect(quickTasksFor('manager').map((t) => t.href)).not.toContain('/manager/intake');
  });

  it('состав отличается по ролям — это задачи роли, а не общий список', () => {
    const partner = quickTasksFor('partner')
      .map((t) => t.href)
      .join();
    const admin = quickTasksFor('admin')
      .map((t) => t.href)
      .join();
    expect(partner).not.toBe(admin);
  });
});
