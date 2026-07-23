import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { FeatureFlagsMatrix } from '@/components/admin/feature-flags-matrix';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

/**
 * ФТ-14.6: read-only матрица флагов. Компонент серверный и презентационный —
 * рендерим renderToString и смотрим текст (паттерн фазы 3 coverage-гейта).
 */

const ENV_KEYS = FEATURE_FLAGS.map((f) => `FEATURE_${f.toUpperCase()}`);
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('FeatureFlagsMatrix', () => {
  it('перечисляет все флаги с env-переменной и типом', () => {
    const html = renderToString(React.createElement(FeatureFlagsMatrix));
    for (const flag of FEATURE_FLAGS) {
      expect(html).toContain(`FEATURE_${flag.toUpperCase()}`);
    }
    expect(html).toContain('включается явно');
    expect(html).toContain('включён по умолчанию');
  });

  it('состояние из isFeatureEnabled: opt-out без env — включён, opt-in — выключен, env переворачивает', () => {
    process.env.FEATURE_CHAT = '1'; // opt-in → включён
    process.env.FEATURE_PARTNER_LEADS = '0'; // opt-out → выключен
    const html = renderToString(React.createElement(FeatureFlagsMatrix));
    expect(html).toContain('включён</span>');
    expect(html).toContain('выключен</span>');
  });

  it('инфраструктурные env перечислены по именам, значения не выводятся', () => {
    process.env.DATABASE_URL = 'postgres://user:supersecretpass@host/db';
    const html = renderToString(React.createElement(FeatureFlagsMatrix));
    expect(html).toContain('DATABASE_URL');
    expect(html).toContain('JWT_SECRET');
    expect(html).toContain('REDIS_URL');
    expect(html).toContain('S3_*');
    expect(html).not.toContain('supersecretpass');
  });
});
