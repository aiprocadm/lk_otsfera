/**
 * Fail-fast валидация production-окружения (R0.2 release hardening).
 *
 * До этого модуля защита конфигурации была размазана по ленивым точечным
 * проверкам (jwt.ts, storage/s3.ts, jobs/connection.ts бросают при первом
 * ИСПОЛЬЗОВАНИИ) — приложение поднималось с пустыми/плейсхолдерными
 * секретами и падало на первом запросе. Теперь:
 *
 *  - web:    src/instrumentation.ts → register() (nodejs runtime) зовёт
 *            assertEnvOnBoot() до инициализации Sentry;
 *  - worker: src/worker/index.ts → main() зовёт assertEnvOnBoot() до
 *            старта очередей.
 *
 * Контракт: вне NODE_ENV=production — полный no-op (dev/test работают с
 * минимальным .env, MinIO-кредами и т.п.). В production невалидное
 * окружение — throw со СПИСКОМ имён переменных (значения секретов в
 * сообщение не попадают никогда).
 *
 * Условные требования держим минимальными и только для конфигураций,
 * которые в бою гарантированно ломаются или опасны (rest-1С без урла,
 * EMAIL_ENABLED без ключа, IMAP-адаптер без кредов, включённая телефония
 * без подписи вебхука, SHOW_DEMO_LOGINS). Каналы Max/WhatsApp намеренно
 * не проверяются: у них штатный graceful degrade «флаг+креды».
 */
import { z } from 'zod';

/** Плейсхолдеры из .env.example / .env.production.example. */
const PLACEHOLDER_RE = /replace_with|replace_me|changeme|change_me/i;
const PLACEHOLDER_MSG = 'осталось плейсхолдер-значение из .env.example';
const notPlaceholder = (v: string) => !PLACEHOLDER_RE.test(v);

/** Зеркалит TRUTHY_VALUES фиче-флагов (featureFlags.ts). */
const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const isTruthy = (v: string | undefined) => TRUTHY.has((v ?? '').trim().toLowerCase());

const requiredSecret = (minLen: number) =>
  z
    .string({ required_error: 'обязательна в production' })
    .trim()
    .min(minLen, `минимум ${minLen} символа(ов)`)
    .refine(notPlaceholder, PLACEHOLDER_MSG);

const requiredNonEmpty = (why: string) => z.string({ required_error: why }).trim().min(1, why);

const s3Credential = () =>
  requiredNonEmpty('обязательна в production')
    .refine(notPlaceholder, PLACEHOLDER_MSG)
    .refine((v) => v !== 'minioadmin', 'dev-креды MinIO недопустимы в production');

const optionalStr = z.string().optional();

export const productionEnvSchema = z
  .object({
    DATABASE_URL: requiredNonEmpty('обязательна в production'),
    APP_URL: z
      .string({
        required_error:
          'обязательна в production (абсолютные ссылки в письмах/уведомлениях; без неё действует hardcode-fallback)',
      })
      .trim()
      .url('должна быть валидным URL (https://<домен>)'),
    JWT_SECRET: requiredSecret(32),
    HEALTH_TOKEN: requiredSecret(32),
    REDIS_URL: requiredNonEmpty(
      'обязательна в production (BullMQ-воркер, очереди уведомлений, rate-limit)'
    ),
    S3_ENDPOINT: z
      .string({ required_error: 'обязательна в production' })
      .trim()
      .url('должна быть валидным URL'),
    S3_ACCESS_KEY_ID: s3Credential(),
    S3_SECRET_ACCESS_KEY: s3Credential(),
    S3_BUCKET: requiredNonEmpty('обязательна в production'),
    /** Опционален (fallback на JWT_SECRET), но если задан — те же требования. */
    STUDENT_BRIDGE_JWT_SECRET: z
      .string()
      .trim()
      .min(32, 'минимум 32 символа(ов)')
      .refine(notPlaceholder, PLACEHOLDER_MSG)
      .optional(),
    // Ключи ниже сами по себе опциональны — условия в superRefine.
    ONE_C_ADAPTER: optionalStr,
    ONE_C_API_URL: optionalStr,
    ONE_C_API_TOKEN: optionalStr,
    EMAIL_ENABLED: optionalStr,
    RESEND_API_KEY: optionalStr,
    INBOUND_EMAIL_ADAPTER: optionalStr,
    IMAP_HOST: optionalStr,
    IMAP_USER: optionalStr,
    IMAP_PASSWORD: optionalStr,
    FEATURE_TELEPHONY_MANGO: optionalStr,
    MANGO_API_KEY: optionalStr,
    MANGO_API_SALT: optionalStr,
    SHOW_DEMO_LOGINS: optionalStr,
  })
  .superRefine((env, ctx) => {
    const requireIf = (cond: boolean, key: keyof typeof env, message: string) => {
      if (cond && !env[key]?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
      }
    };

    const oneCRest = env.ONE_C_ADAPTER?.trim() === 'rest';
    requireIf(oneCRest, 'ONE_C_API_URL', 'обязательна при ONE_C_ADAPTER=rest');
    requireIf(oneCRest, 'ONE_C_API_TOKEN', 'обязательна при ONE_C_ADAPTER=rest');

    const emailOn = env.EMAIL_ENABLED?.trim() === 'true';
    requireIf(emailOn, 'RESEND_API_KEY', 'обязательна при EMAIL_ENABLED=true');
    if (emailOn && env.RESEND_API_KEY && !notPlaceholder(env.RESEND_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: PLACEHOLDER_MSG,
      });
    }

    const imap = env.INBOUND_EMAIL_ADAPTER?.trim() === 'imap';
    requireIf(imap, 'IMAP_HOST', 'обязательна при INBOUND_EMAIL_ADAPTER=imap');
    requireIf(imap, 'IMAP_USER', 'обязательна при INBOUND_EMAIL_ADAPTER=imap');
    requireIf(imap, 'IMAP_PASSWORD', 'обязательна при INBOUND_EMAIL_ADAPTER=imap');

    const mangoOn = isTruthy(env.FEATURE_TELEPHONY_MANGO);
    requireIf(
      mangoOn,
      'MANGO_API_KEY',
      'обязательна при FEATURE_TELEPHONY_MANGO (подпись вебхука fail-closed)'
    );
    requireIf(
      mangoOn,
      'MANGO_API_SALT',
      'обязательна при FEATURE_TELEPHONY_MANGO (подпись вебхука fail-closed)'
    );

    if (isTruthy(env.SHOW_DEMO_LOGINS)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHOW_DEMO_LOGINS'],
        message: 'НИКОГДА не включать в production — раскрытие демо-учёток на /login',
      });
    }
  });

export interface EnvValidationResult {
  ok: boolean;
  /** «KEY: причина», без значений — сообщения безопасно логировать. */
  issues: string[];
}

export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const parsed = productionEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, issues: [] };
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  return { ok: false, issues };
}

/**
 * Boot-гейт: в production бросает при невалидном окружении (процесс не
 * стартует), вне production — no-op. Значения переменных в сообщение об
 * ошибке не попадают — только имена и причины.
 */
export function assertEnvOnBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const { ok, issues } = validateProductionEnv(env);
  if (ok) return;
  throw new Error(
    `Некорректное production-окружение (${issues.length} проблем):\n` +
      issues.map((s) => `  - ${s}`).join('\n') +
      '\nСм. .env.production.example. Приложение намеренно не стартует (R0.2 fail-fast).'
  );
}
