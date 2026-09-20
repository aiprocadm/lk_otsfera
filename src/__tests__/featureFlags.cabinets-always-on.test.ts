import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FEATURE_FLAGS, FEATURE_PREFIXES, isFeatureEnabled } from '@/lib/featureFlags';
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';
import { roleHome } from '@/lib/auth/access';

/**
 * `У-262` (пачка A) — кабинеты заказчика, менеджера и руководителя открываются
 * **при полностью пустом окружении**.
 *
 * Это прямая проверка того, что гейт исчез, а не переехал. Раньше у этих трёх
 * разделов был выключатель: без `FEATURE_MANAGER_CABINET=1` кабинет отвечал
 * 404, меню было пустым, а руководителя middleware уводил в чужой кабинет.
 * Выключатель снят — кабинет роли это не эксперимент: выключенный кабинет
 * означает не «откатили фичу», а «роль не может войти никуда».
 *
 * Тест намеренно СТИРАЕТ окружение, а не выставляет флаги в ноль: если бы
 * где-то остался забытый `isFeatureEnabled('manager_cabinet')`, при пустом env
 * он вернул бы `false` (флаги были opt-in) — и меню снова оказалось бы пустым.
 */
const ORIGINAL_ENV = { ...process.env };

/** Имена, которых больше нет. Читаем их как строки: типа для них уже не существует. */
const REMOVED = ['organization_cabinet', 'manager_cabinet', 'leader_cabinet'];

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const flag of REMOVED) delete process.env[`FEATURE_${flag.toUpperCase()}`];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('кабинеты работают без флагов (У-262)', () => {
  it('снятых имён нет ни в списке флагов, ни в route-префиксах', () => {
    const flags = FEATURE_FLAGS as readonly string[];
    for (const flag of REMOVED) {
      expect(flags, `флаг ${flag} снова в списке`).not.toContain(flag);
    }
    const prefixFlags = FEATURE_PREFIXES.map((p) => p.flag as string);
    for (const flag of REMOVED) {
      expect(prefixFlags, `флаг ${flag} снова гейтит маршрут`).not.toContain(flag);
    }
  });

  it('меню менеджера при пустом окружении полное, а не «одна Справка»', () => {
    const items = navItemsFor('manager');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/manager/dashboard');
    expect(hrefs).toContain('/manager/orders');
    expect(hrefs).toContain('/manager/documents');
    // Раньше при выключенном флаге оставалась ровно одна строка.
    expect(hrefs.length).toBeGreaterThan(5);
  });

  it('меню заказчика при пустом окружении не пустое', () => {
    const hrefs = navItemsFor('organization').map((i) => i.href);
    expect(hrefs).toContain('/organization/dashboard');
    expect(hrefs.length).toBeGreaterThan(3);
  });

  it('меню руководителя при пустом окружении не пустое', () => {
    const hrefs = navItemsFor('leader').map((i) => i.href);
    expect(hrefs).toContain('/leader/dashboard');
    expect(hrefs.length).toBeGreaterThan(3);
  });

  it('ни один пункт трёх кабинетов не ссылается на снятый флаг', () => {
    for (const role of ['manager', 'organization', 'leader'] as const) {
      for (const item of navByRole[role]) {
        const used: string[] = [item.flag, ...(item.anyFlags ?? [])].filter(
          (f) => typeof f === 'string'
        );
        for (const flag of used) {
          expect(REMOVED, `пункт ${item.href} ссылается на снятый флаг ${flag}`).not.toContain(
            flag
          );
        }
      }
    }
  });

  it('дом руководителя — его собственный кабинет, а не чужой', () => {
    // Развилка «если флаг выключен, веди в /manager/dashboard» жила в
    // middleware и ушла вместе с флагом.
    expect(roleHome.leader).toBe('/leader/dashboard');
  });

  it('забытый вызов снятого флага не прячет раздел', () => {
    // Свойство, которое стоит знать и не сломать. Снятое имя больше не входит
    // в список opt-in, поэтому `isFeatureEnabled` отвечает на него `true`:
    // неизвестные флаги в проекте считаются включёнными по умолчанию
    // (opt-out — безопасное умолчание, чтобы забытая переменная окружения не
    // прятала работающую функцию).
    //
    // Значит, если где-то останется забытый вызов с этим именем, раздел
    // **останется видимым**, а не исчезнет. Ошибка уборки падает в безопасную
    // сторону — но это не повод оставлять такие вызовы: их отсутствие
    // проверяет тест выше и `security.feature-flags-removed.guardrail`.
    for (const flag of REMOVED) {
      expect(isFeatureEnabled(flag as never)).toBe(true);
    }
  });
});
