import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  FEATURE_FLAGS,
  FEATURE_PREFIXES,
  isRouteGatedFlag,
  type FeatureFlag,
} from '@/lib/featureFlags';
import { SENSITIVE_FLAGS } from '@/lib/services/admin/featureFlags';
import { readSource } from './helpers/source';

/**
 * Страж границы «что можно переключать из интерфейса» (`У-65`, этап 8).
 *
 * Флаг, который читает middleware, переключать из базы нельзя: middleware
 * работает в edge-среде, где базы нет, и включение из интерфейса было бы
 * иллюзией управления. Граница проходит ровно по `FEATURE_PREFIXES`, и
 * список обязан быть ОДИН: если middleware заведёт свою копию, экран начнёт
 * предлагать переключатели, которые ничего не делают.
 */
describe('граница route-флагов (У-65)', () => {
  it('middleware не держит собственной копии списка префиксов', () => {
    const src = readSource(join(process.cwd(), 'src/middleware.ts'));
    expect(src).toContain('FEATURE_PREFIXES');
    // Объявление живёт в featureFlags.ts — middleware только импортирует.
    expect(src).not.toMatch(/const\s+FEATURE_PREFIXES\s*[:=]/);
  });

  it('гейт бежит ИМЕННО по импортированному списку, а не по своей выборке', () => {
    // Прежней проверки мало: копия под другим именем
    // (`const GATED = FEATURE_PREFIXES.filter(...)`) оставляла импорт
    // использованным, поэтому её не видели ни страж, ни линтер, ни knip.
    // А раздел с выключенным флагом при этом снова открывался по прямой
    // ссылке (прогон №28). Проверяем то, что важно: цикл гейтинга идёт по
    // самому списку, и рядом с ним стоит отказ 404.
    const src = readSource(join(process.cwd(), 'src/middleware.ts'));
    const loop = /for\s*\(\s*const\s*\{[^}]*\}\s*of\s*FEATURE_PREFIXES\s*\)([\s\S]{0,400})/.exec(
      src
    );
    expect(loop, 'цикл гейтинга не идёт по FEATURE_PREFIXES').not.toBeNull();
    expect(loop![1], 'в цикле нет проверки флага').toContain('isFeatureEnabled(');
    expect(loop![1], 'в цикле нет отказа 404').toContain('404');
  });

  it('каждый флаг из префиксов помечен как непереключаемый', () => {
    for (const { flag } of FEATURE_PREFIXES) {
      expect(isRouteGatedFlag(flag), `${flag} закрывает раздел`).toBe(true);
    }
  });

  it('флаги вне префиксов переключаемы — иначе экран потерял бы смысл', () => {
    const gated = new Set(FEATURE_PREFIXES.map((p) => p.flag));
    const editable = FEATURE_FLAGS.filter((f) => !gated.has(f));
    expect(editable.length).toBeGreaterThan(0);
    for (const flag of editable) {
      expect(isRouteGatedFlag(flag), `${flag} не закрывает раздел`).toBe(false);
    }
  });

  it('опасные флаги существуют и перечислены осознанно (У-68)', () => {
    // Список не должен молча распухнуть: подтверждение на каждый флаг обесценит
    // подтверждение вообще.
    expect(SENSITIVE_FLAGS.length).toBeLessThanOrEqual(6);
    for (const flag of SENSITIVE_FLAGS) {
      expect(FEATURE_FLAGS).toContain(flag as FeatureFlag);
    }
  });
});
