import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import {
  FEATURE_FLAGS,
  isFeatureEnabled,
  isOptInFlag,
  isRouteGatedFlag,
  featureFlagEnvVar,
  type FeatureFlag,
} from '@/lib/featureFlags';
import {
  featureSettingKey,
  primeFeatureFlagCache,
  resetFeatureFlagCache,
} from '@/lib/config/featureFlagStore';

/**
 * Управление флагами функциональности из интерфейса (`У-65`…`У-68`).
 *
 * Значения лежат в `IntegrationSetting` под префиксом `feature.` — та же
 * таблица и тот же механизм, что у настроек интеграций (`У-65` в ТЗ называет
 * её `Setting`; таблицы с таким именем в схеме нет, вторую заводить не стали).
 *
 * **Флаги, закрывающие целые разделы, переключать нельзя** — они читаются в
 * edge-middleware, где базы нет: переключатель включал бы флаг, а middleware
 * продолжал бы отдавать 404. Такие флаги отдаются только для чтения, и запрет
 * держится не только скрытой кнопкой, но и проверкой в сервисе (§4).
 */

/** Откуда взято текущее значение (`У-66`). */
export type FlagSource = 'ui' | 'env' | 'default';

export type FeatureFlagRow = {
  flag: FeatureFlag;
  enabled: boolean;
  source: FlagSource;
  /** Можно ли переключать из интерфейса. `false` — флаг раздела (`У-65`). */
  editable: boolean;
  /** Требует подтверждения с текстом последствия (`У-68`). */
  sensitive: boolean;
  envVar: string;
  /** Значение по умолчанию: opt-in флаги выключены, остальные включены. */
  defaultEnabled: boolean;
};

/**
 * Флаги доступа и денег (`У-68`). Переключение таких — не «галочка», а
 * решение с последствиями, поэтому UI обязан спросить подтверждение с прямым
 * текстом, а не общим «вы уверены?».
 */
export const SENSITIVE_FLAGS: readonly FeatureFlag[] = [
  'role_constructor',
  'pii_access_log',
  'commission_pdf',
  'commission_xlsx',
];

export function isSensitiveFlag(flag: FeatureFlag): boolean {
  return SENSITIVE_FLAGS.includes(flag);
}

const TRUE_VALUE = '1';
const FALSE_VALUE = '0';

/** Список флагов с текущим значением и источником. Ничего не пишет. */
export async function listFeatureFlags(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; rows: FeatureFlagRow[] } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  await primeFeatureFlagCache(prisma);

  const stored = await prisma.integrationSetting.findMany({
    where: { key: { startsWith: 'feature.' } },
    select: { key: true, value: true },
  });
  const storedFlags = new Set(
    stored
      .filter((r) => r.value !== null && r.value !== '')
      .map((r) => r.key.slice('feature.'.length))
  );

  return {
    ok: true,
    rows: FEATURE_FLAGS.map((flag) => ({
      flag,
      enabled: isFeatureEnabled(flag),
      source: sourceOf(flag, storedFlags.has(flag)),
      editable: !isRouteGatedFlag(flag),
      sensitive: isSensitiveFlag(flag),
      envVar: featureFlagEnvVar(flag),
      defaultEnabled: !isOptInFlag(flag),
    })),
  };
}

function sourceOf(flag: FeatureFlag, inDb: boolean): FlagSource {
  if (inDb) return 'ui';
  const raw = process.env[featureFlagEnvVar(flag)];
  return raw === undefined || raw === '' ? 'default' : 'env';
}

type SetError = 'forbidden' | 'unknown_flag' | 'not_editable';

/**
 * Переключение флага (`У-65`) с записью в журнал (`У-67`).
 *
 * `enabled: null` — «вернуть к значению по умолчанию»: строка удаляется, и
 * флаг снова читается из переменной окружения. Без этого выхода первое же
 * переключение навсегда отвязало бы систему от серверной настройки.
 */
export async function setFeatureFlag(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { flag: string; enabled: boolean | null }
): Promise<{ ok: true; enabled: boolean; source: FlagSource } | { ok: false; error: SetError }> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const flag = FEATURE_FLAGS.find((f) => f === args.flag);
  if (!flag) return { ok: false, error: 'unknown_flag' };
  // Гард на сервере, а не только скрытая кнопка (§4): подделать запрос к
  // route-флагу бесполезно — включить его база всё равно не может.
  if (isRouteGatedFlag(flag)) return { ok: false, error: 'not_editable' };

  await primeFeatureFlagCache(prisma);
  const before = isFeatureEnabled(flag);
  const key = featureSettingKey(flag);

  if (args.enabled === null) {
    await prisma.integrationSetting.deleteMany({ where: { key } });
  } else {
    const value = args.enabled ? TRUE_VALUE : FALSE_VALUE;
    await prisma.integrationSetting.upsert({
      where: { key },
      create: { key, value, isSecret: false, updatedBy: session.sub },
      update: { value, updatedBy: session.sub },
    });
  }

  // Снапшот устарел — иначе экран показал бы прежнее значение до конца TTL.
  resetFeatureFlagCache();
  await primeFeatureFlagCache(prisma);
  const after = isFeatureEnabled(flag);

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'feature_flag.changed',
    entity: 'feature_flag',
    entityId: flag,
    before: { enabled: before },
    after: {
      enabled: after,
      mode: args.enabled === null ? 'reset_to_env' : 'set_in_ui',
      sensitive: isSensitiveFlag(flag),
    },
  });

  return { ok: true, enabled: after, source: sourceOf(flag, args.enabled !== null) };
}
