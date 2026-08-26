import { describe, expect, it } from 'vitest';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';
import { FEATURE_FLAGS, featureFlagEnvVar } from '@/lib/featureFlags';
import { ENV_ONLY } from './helpers/envRegistry';
import { collectEnvReads } from './helpers/envScan';

/**
 * `У-122`: явный список переменных, остающихся в env.
 *
 * Настройки платформы живут в базе и правятся из интерфейса; env — только
 * инфраструктура, среда, тестовые нобы и легальные fallback'и переехавших
 * настроек (`SETTING_SPECS[*].envVar`, приоритет «база → env → умолчание»).
 * Новое буквальное чтение `process.env.X` вне этих множеств — красная
 * сборка: либо переменной место в `IntegrationSetting` (заведи `SettingSpec`
 * и форму), либо она инфраструктурная — тогда впиши её в реестр
 * [helpers/envRegistry.ts](./helpers/envRegistry.ts) с причиной И
 * задокументируй в `.env.example` (страж `config.env-example.guardrail`).
 */
describe('У-122: process.env читается только по явному реестру', () => {
  it('каждая буквально читаемая переменная — в реестре или fallback настройки', () => {
    const reads = collectEnvReads();
    // Смок против пустого сбора: страж, который ничего не нашёл, смотрит не туда.
    expect(reads.size).toBeGreaterThan(30);

    const settingFallbacks = new Set<string>(
      Object.values(SETTING_SPECS).flatMap((s) => (s.envVar === null ? [] : [s.envVar]))
    );
    // env-fallback'и флагов (`FEATURE_<ФЛАГ>`) — легальны по построению:
    // у route-флагов env — единственный источник (edge), у поведенческих —
    // запасной с приоритетом «база → env».
    const flagEnvs = new Set<string>(FEATURE_FLAGS.map((f) => featureFlagEnvVar(f)));

    const offenders = [...reads.entries()]
      .filter(([name]) => !(name in ENV_ONLY) && !settingFallbacks.has(name) && !flagEnvs.has(name))
      .map(([name, files]) => `${name} ← ${[...files].join(', ')}`);

    expect(
      offenders,
      'Переменная окружения вне реестра У-122 — новым настройкам место в ' +
        'IntegrationSetting (SettingSpec + форма), инфраструктуре — в ' +
        'helpers/envRegistry.ts с причиной:\n'
    ).toEqual([]);
  });

  it('реестр не держит мёртвых строк: каждая инфраструктурная переменная читается кодом', () => {
    const reads = collectEnvReads();
    // Исключений нет: даже DATABASE_URL, которую в рантайме читает Prisma,
    // сбор видит в production-схеме `lib/env.ts`.
    const dead = Object.keys(ENV_ONLY).filter((n) => !reads.has(n));
    expect(
      dead,
      'Реестр У-122 описывает переменную, которую код больше не читает, — убери строку:\n'
    ).toEqual([]);
  });
});
