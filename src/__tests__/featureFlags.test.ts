import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isFeatureEnabled,
  requireFeature,
  notFoundIfDisabled,
  FeatureDisabledError,
  FEATURE_FLAGS,
  type FeatureFlag,
} from '@/lib/featureFlags';

const ORIGINAL_ENV = { ...process.env };

function clearAllFeatureEnvs() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_')) delete process.env[key];
  }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearAllFeatureEnvs();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// Opt-in flags invert the default and have separate coverage below.
// Прогон сопровождения №37: в opt-in остались флаги внешней неготовности
// (бот, агрегатор, АТС, Redis с воркером, доставка писем) и `cabinet_questions`,
// которому без `inbound_messaging` нечем ответить клиенту.
const OPT_IN_FLAGS = new Set<FeatureFlag>([
  'max_channel',
  'whatsapp_channel',
  'notif_queue',
  'inbound_messaging',
  'telephony_mango',
  'staff_2fa',
  'cabinet_questions',
]);

/**
 * Готовые функции, которым нужна одна база, — включены по умолчанию
 * (решение от 23.09.2026, приёмочный критерий §0.3 «ничего не включается на
 * сервере»). Список явный, а не выведенный из кода: вернись любой из них в
 * `OPT_IN_FLAGS` — свежий прод молча потеряет раздел, и этот страж покраснеет.
 */
const READY_BY_DEFAULT = [
  'chat',
  'role_constructor',
  'sales_funnel',
  'leader_analytics',
  'internal_tasks',
  'contacts',
  'bitrix_migration',
  'comm_center',
  'automation',
  'notification_center',
  'staff_chat',
  'staff_calendar',
  'global_search',
] as const satisfies readonly FeatureFlag[];

describe('isFeatureEnabled', () => {
  it('returns true when the env var is unset (default-enabled opt-out flags)', () => {
    for (const flag of FEATURE_FLAGS) {
      if (OPT_IN_FLAGS.has(flag)) continue;
      expect(isFeatureEnabled(flag)).toBe(true);
    }
  });

  it('returns true when the env var is empty string', () => {
    process.env.FEATURE_COMMISSION_PDF = '';
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
  });

  it('staff_2fa is opt-in: disabled by default, enabled by FEATURE_STAFF_2FA=1', () => {
    delete process.env.FEATURE_STAFF_2FA;
    expect(isFeatureEnabled('staff_2fa')).toBe(false);
    process.env.FEATURE_STAFF_2FA = '1';
    expect(isFeatureEnabled('staff_2fa')).toBe(true);
  });

  it.each(['0', 'false', 'off', 'no', 'disabled', 'False', 'OFF', ' 0 '])(
    'returns false for falsy value %s',
    (val) => {
      process.env.FEATURE_COMMISSION_PDF = val;
      expect(isFeatureEnabled('commission_pdf')).toBe(false);
    }
  );

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'anything-else'])(
    'returns true for truthy / unknown value %s',
    (val) => {
      process.env.FEATURE_COMMISSION_PDF = val;
      expect(isFeatureEnabled('commission_pdf')).toBe(true);
    }
  );

  it('reads each flag from its own dedicated env key', () => {
    process.env.FEATURE_COMMISSION_PDF = '0';
    expect(isFeatureEnabled('commission_pdf')).toBe(false);
    // other flags untouched
    expect(isFeatureEnabled('commission_xlsx')).toBe(true);
    expect(isFeatureEnabled('pwa_installer')).toBe(true);
  });

  it('reflects runtime env mutations (re-reads on every call)', () => {
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
    process.env.FEATURE_COMMISSION_PDF = '0';
    expect(isFeatureEnabled('commission_pdf')).toBe(false);
    delete process.env.FEATURE_COMMISSION_PDF;
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
  });
});

describe('requireFeature', () => {
  it('returns silently when enabled', () => {
    expect(() => requireFeature('commission_pdf')).not.toThrow();
  });

  it('throws FeatureDisabledError when disabled, carrying the flag name', () => {
    process.env.FEATURE_COMMISSION_PDF = '0';
    let err: unknown;
    try {
      requireFeature('commission_pdf');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as FeatureDisabledError).flag).toBe('commission_pdf');
    expect((err as Error).message).toContain('commission_pdf');
  });
});

describe('notFoundIfDisabled', () => {
  it('returns null when the flag is enabled', () => {
    expect(notFoundIfDisabled('commission_pdf')).toBeNull();
  });

  it('returns a 404 Response when disabled', async () => {
    process.env.FEATURE_COMMISSION_PDF = 'off';
    const res = notFoundIfDisabled('commission_pdf');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.text()).toBe('Not Found');
  });
});

describe('готовые функции включены по умолчанию (прогон №37, §0.3)', () => {
  it.each(READY_BY_DEFAULT)('%s: включён при пустом env', (flag) => {
    expect(isFeatureEnabled(flag)).toBe(true);
  });

  it.each(READY_BY_DEFAULT)('%s: флаг остался аварийным тормозом — =0 выключает', (flag) => {
    process.env[`FEATURE_${flag.toUpperCase()}`] = '0';
    expect(isFeatureEnabled(flag)).toBe(false);
  });

  it('флаги внешней неготовности по-прежнему выключены при пустом env', () => {
    for (const flag of OPT_IN_FLAGS) {
      expect(isFeatureEnabled(flag)).toBe(false);
    }
  });

  it('при пустом env клиент не может спросить, если менеджер не может ответить', () => {
    // Находка проверки прогона №37: `cabinet_questions` включили по умолчанию,
    // а `inbound_messaging` — нет. Клиент задавал вопрос, менеджер получал
    // уведомление со ссылкой на 404 и не мог ответить: ответ на диалог канала
    // `cabinet` живёт только в «Мессенджерах» под `inbound_messaging`.
    // Проверяем следствие «можно спросить ⇒ можно ответить», а не два
    // значения по отдельности: если однажды оба флага станут включёнными по
    // умолчанию, страж не должен мешать.
    const canAsk = isFeatureEnabled('cabinet_questions');
    const canAnswer = isFeatureEnabled('inbound_messaging');
    expect(
      !canAsk || canAnswer,
      `«Задать вопрос» включён по умолчанию (${canAsk}), а ответ — нет (${canAnswer})`
    ).toBe(true);
    // Включённые вместе, оба работают.
    process.env.FEATURE_INBOUND_MESSAGING = '1';
    process.env.FEATURE_CABINET_QUESTIONS = '1';
    expect(isFeatureEnabled('cabinet_questions')).toBe(true);
    expect(isFeatureEnabled('inbound_messaging')).toBe(true);
  });

  it('opt-in флаг включается только явным «да»: мусорное значение его не включает', () => {
    process.env.FEATURE_NOTIF_QUEUE = 'anything-else';
    expect(isFeatureEnabled('notif_queue')).toBe(false);
    process.env.FEATURE_NOTIF_QUEUE = ' ON ';
    expect(isFeatureEnabled('notif_queue')).toBe(true);
  });
});

describe('pii_access_log (§25.7)', () => {
  it('opt-out: включён при пустом env', () => {
    expect(isFeatureEnabled('pii_access_log')).toBe(true);
  });

  it('kill-switch: FEATURE_PII_ACCESS_LOG=0 выключает', () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    expect(isFeatureEnabled('pii_access_log')).toBe(false);
  });
});

describe('isOptInFlag / featureFlagEnvVar (ФТ-14.6 — матрица флагов)', () => {
  it('opt-in флаги распознаются, opt-out — нет', async () => {
    const { isOptInFlag } = await import('@/lib/featureFlags');
    expect(isOptInFlag('notif_queue')).toBe(true);
    expect(isOptInFlag('staff_2fa')).toBe(true);
    expect(isOptInFlag('cabinet_questions')).toBe(true);
    // Прогон №37: готовые функции переведены в opt-out.
    expect(isOptInFlag('chat')).toBe(false);
    expect(isOptInFlag('staff_calendar')).toBe(false);
    expect(isOptInFlag('commission_pdf')).toBe(false);
    expect(isOptInFlag('pii_access_log')).toBe(false);
  });

  it('featureFlagEnvVar строит FEATURE_<UPPER_SNAKE>', async () => {
    const { featureFlagEnvVar } = await import('@/lib/featureFlags');
    expect(featureFlagEnvVar('chat')).toBe('FEATURE_CHAT');
    expect(featureFlagEnvVar('staff_2fa')).toBe('FEATURE_STAFF_2FA');
  });
});
