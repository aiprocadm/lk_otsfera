/**
 * src/lib/env.ts — fail-fast валидация production-окружения (R0.2).
 * Контракты: no-op вне production; в production невалидное окружение —
 * throw со списком ИМЁН переменных (значения секретов не утекают).
 */
import { describe, expect, it } from 'vitest';
import { assertEnvOnBoot, validateProductionEnv } from '@/lib/env';

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host:5432/cabinet',
    APP_URL: 'https://lk.example.ru',
    JWT_SECRET: 'a'.repeat(32),
    HEALTH_TOKEN: 'h'.repeat(40),
    // `У-132`: мастер-ключ секретов интеграций обязателен в production —
    // сервер, на котором интеграции нельзя настроить, не поднимается.
    APP_ENCRYPTION_KEY: 'k'.repeat(64),
    REDIS_URL: 'redis://redis:6379',
    S3_ENDPOINT: 'https://s3.provider.ru',
    S3_ACCESS_KEY_ID: 'real-access-key',
    S3_SECRET_ACCESS_KEY: 'real-secret-key',
    S3_BUCKET: 'documents',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function issuesFor(overrides: Record<string, string | undefined>): string[] {
  return validateProductionEnv(validEnv(overrides)).issues;
}

describe('validateProductionEnv — базовый набор', () => {
  it('полное валидное окружение → ok, ноль issues', () => {
    expect(validateProductionEnv(validEnv())).toEqual({ ok: true, issues: [] });
  });

  it('без аргумента читает process.env (в тестах оно не production-полное → ok:false)', () => {
    const result = validateProductionEnv();
    expect(typeof result.ok).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('отсутствующая DATABASE_URL → issue с именем переменной', () => {
    expect(issuesFor({ DATABASE_URL: undefined }).join('\n')).toContain('DATABASE_URL');
  });

  it('пустая DATABASE_URL → issue', () => {
    expect(issuesFor({ DATABASE_URL: '  ' }).join('\n')).toContain('DATABASE_URL');
  });

  it('невалидный APP_URL → issue', () => {
    expect(issuesFor({ APP_URL: 'not-a-url' }).join('\n')).toContain('APP_URL');
  });

  it('короткий JWT_SECRET (<32) → issue', () => {
    expect(issuesFor({ JWT_SECRET: 'short' }).join('\n')).toContain('JWT_SECRET');
  });

  it('плейсхолдерный JWT_SECRET (32+ символов) → issue про плейсхолдер', () => {
    const issues = issuesFor({ JWT_SECRET: 'replace_with_at_least_32_chars__' });
    expect(issues.join('\n')).toContain('JWT_SECRET');
    expect(issues.join('\n')).toContain('плейсхолдер');
  });

  it('отсутствующий APP_ENCRYPTION_KEY → issue (У-132, дефект Д-36)', () => {
    // Без ключа секреты, введённые в интерфейсе, сохранить нельзя, а узнавал
    // об этом человек только нажав «Сохранить».
    expect(issuesFor({ APP_ENCRYPTION_KEY: undefined }).join('\n')).toContain('APP_ENCRYPTION_KEY');
  });

  it('отсутствующий HEALTH_TOKEN → issue (плейсхолдер стал бы публично известным bearer)', () => {
    expect(issuesFor({ HEALTH_TOKEN: undefined }).join('\n')).toContain('HEALTH_TOKEN');
  });

  it('отсутствующий REDIS_URL → issue', () => {
    expect(issuesFor({ REDIS_URL: undefined }).join('\n')).toContain('REDIS_URL');
  });

  it('невалидный S3_ENDPOINT → issue', () => {
    expect(issuesFor({ S3_ENDPOINT: 'minio' }).join('\n')).toContain('S3_ENDPOINT');
  });

  it('S3-креды minioadmin → issue про dev-креды', () => {
    const issues = issuesFor({
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadmin',
    });
    expect(issues.join('\n')).toContain('MinIO');
  });

  it('плейсхолдерный S3_SECRET_ACCESS_KEY (replace_me) → issue', () => {
    expect(issuesFor({ S3_SECRET_ACCESS_KEY: 'replace_me' }).join('\n')).toContain(
      'S3_SECRET_ACCESS_KEY'
    );
  });

  it('пустой S3_BUCKET → issue', () => {
    expect(issuesFor({ S3_BUCKET: '' }).join('\n')).toContain('S3_BUCKET');
  });
});

describe('validateProductionEnv — STUDENT_BRIDGE_JWT_SECRET (опционален с требованиями)', () => {
  it('не задан → ok (fallback на JWT_SECRET)', () => {
    expect(validateProductionEnv(validEnv()).ok).toBe(true);
  });

  it('задан коротким → issue', () => {
    expect(issuesFor({ STUDENT_BRIDGE_JWT_SECRET: 'short' }).join('\n')).toContain(
      'STUDENT_BRIDGE_JWT_SECRET'
    );
  });

  it('задан валидным → ok', () => {
    expect(validateProductionEnv(validEnv({ STUDENT_BRIDGE_JWT_SECRET: 's'.repeat(32) })).ok).toBe(
      true
    );
  });
});

describe('validateProductionEnv — условные требования', () => {
  it('ONE_C_ADAPTER=rest без URL/токена → обе issues', () => {
    const joined = issuesFor({ ONE_C_ADAPTER: 'rest' }).join('\n');
    expect(joined).toContain('ONE_C_API_URL');
    expect(joined).toContain('ONE_C_API_TOKEN');
  });

  it('ONE_C_ADAPTER=rest с URL и токеном → ok', () => {
    expect(
      validateProductionEnv(
        validEnv({
          ONE_C_ADAPTER: 'rest',
          ONE_C_API_URL: 'https://1c.example.ru',
          ONE_C_API_TOKEN: 'token-123',
        })
      ).ok
    ).toBe(true);
  });

  it('EMAIL_ENABLED=true без RESEND_API_KEY → issue', () => {
    expect(issuesFor({ EMAIL_ENABLED: 'true' }).join('\n')).toContain('RESEND_API_KEY');
  });

  it('EMAIL_ENABLED=true с плейсхолдерным ключом (re_replace_me) → issue про плейсхолдер', () => {
    const joined = issuesFor({ EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_replace_me' }).join('\n');
    expect(joined).toContain('RESEND_API_KEY');
    expect(joined).toContain('плейсхолдер');
  });

  it('EMAIL_ENABLED=true с реальным ключом → ok', () => {
    expect(
      validateProductionEnv(validEnv({ EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_live_key' })).ok
    ).toBe(true);
  });

  it('INBOUND_EMAIL_ADAPTER=imap без кредов → три issues (host/user/password)', () => {
    const joined = issuesFor({ INBOUND_EMAIL_ADAPTER: 'imap' }).join('\n');
    expect(joined).toContain('IMAP_HOST');
    expect(joined).toContain('IMAP_USER');
    expect(joined).toContain('IMAP_PASSWORD');
  });

  it('INBOUND_EMAIL_ADAPTER=imap с кредами → ok', () => {
    expect(
      validateProductionEnv(
        validEnv({
          INBOUND_EMAIL_ADAPTER: 'imap',
          IMAP_HOST: 'imap.example.ru',
          IMAP_USER: 'inbox@example.ru',
          IMAP_PASSWORD: 'pass',
        })
      ).ok
    ).toBe(true);
  });

  it('FEATURE_TELEPHONY_MANGO=1 без ключа/соли подписи → обе issues', () => {
    const joined = issuesFor({ FEATURE_TELEPHONY_MANGO: '1' }).join('\n');
    expect(joined).toContain('MANGO_API_KEY');
    expect(joined).toContain('MANGO_API_SALT');
  });

  it('FEATURE_TELEPHONY_MANGO=1 с кредами → ok', () => {
    expect(
      validateProductionEnv(
        validEnv({ FEATURE_TELEPHONY_MANGO: '1', MANGO_API_KEY: 'k', MANGO_API_SALT: 's' })
      ).ok
    ).toBe(true);
  });

  it('SHOW_DEMO_LOGINS=on в production → issue (раскрытие демо-учёток)', () => {
    expect(issuesFor({ SHOW_DEMO_LOGINS: 'on' }).join('\n')).toContain('SHOW_DEMO_LOGINS');
  });
});

describe('assertEnvOnBoot', () => {
  it('вне production — no-op даже на пустом окружении', () => {
    expect(() => assertEnvOnBoot({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertEnvOnBoot({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('без аргумента читает process.env (NODE_ENV=test → no-op)', () => {
    expect(() => assertEnvOnBoot()).not.toThrow();
  });

  it('production + валидное окружение → no-throw', () => {
    expect(() => assertEnvOnBoot(validEnv())).not.toThrow();
  });

  it('production + невалидное → throw с именами переменных, но БЕЗ значений секретов', () => {
    const secretValue = 'super-real-secret-that-must-not-leak';
    const env = validEnv({ JWT_SECRET: 'short', S3_SECRET_ACCESS_KEY: secretValue, S3_BUCKET: '' });
    let message = '';
    try {
      assertEnvOnBoot(env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('S3_BUCKET');
    expect(message).toContain('fail-fast');
    expect(message).not.toContain(secretValue);
  });
});
