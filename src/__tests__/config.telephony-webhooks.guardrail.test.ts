import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FEATURE_PREFIXES, isRouteGatedFlag } from '@/lib/featureFlags';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';
import { WEBHOOK_PROVIDERS } from '@/lib/services/admin/webhookSecrets';

/**
 * Стражи PR-2 этапа 4: телефония включается из интерфейса (`У-124`, дефект
 * `Д-38`) и секреты вебхуков задаются оттуда же (`У-123`).
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('У-124: телефония включается из интерфейса (Д-38)', () => {
  it('флаг снят с edge-гейта — иначе включить его из базы физически нельзя', () => {
    // Edge-middleware не видит базу: выключить флаг из интерфейса получалось,
    // а включить нет — переключатель создавал иллюзию управления.
    expect(
      FEATURE_PREFIXES.some((p) => p.flag === 'telephony_mango'),
      'telephony_mango вернулся в FEATURE_PREFIXES'
    ).toBe(false);
    expect(isRouteGatedFlag('telephony_mango')).toBe(false);
  });

  it('раздел закрывают серверные гарды: страница и КАЖДЫЙ роут звонков', () => {
    // Снятие edge-гейта без этого открыло бы раздел всем.
    const page = read('app/manager/calls/page.tsx');
    // Гард пишут двумя равноценными способами — важно, что он есть, а не как
    // называется хелпер.
    expect(page, 'страница звонков осталась без серверного гарда').toMatch(
      /notFoundIfDisabled\('telephony_mango'\)|!isFeatureEnabled\('telephony_mango'\)\)\s*notFound\(\)/
    );

    const routes = walk(join(SRC, 'app', 'api', 'manager', 'calls')).filter((f) =>
      f.endsWith(`${sep}route.ts`)
    );
    expect(routes.length, 'роуты звонков исчезли — проверять нечего').toBeGreaterThan(0);
    const unguarded = routes
      .filter((f) => !readFileSync(f, 'utf8').includes("'telephony_mango'"))
      .map((f) => relative(SRC, f).split(sep).join('/'));
    expect(unguarded, 'роут звонков без гарда флага — раздел открыт').toEqual([]);
  });

  it('оба экрана про телефонию читают флаг одинаково', () => {
    // Здесь стояло сырое чтение process.env, и после переключения флага из
    // интерфейса светофор и карточка статуса показывали разное.
    const src = read('lib/services/admin/integrations.ts');
    // Ищем ЧТЕНИЕ, а не упоминание: имя переменной может остаться в
    // комментарии, и это не регресс.
    expect(src, 'integrations.ts снова читает флаг из окружения напрямую').not.toContain(
      'process.env.FEATURE_TELEPHONY_MANGO'
    );
    expect(src).toContain("isFeatureEnabled('telephony_mango')");
  });

  it('адаптер, разрешённые адреса и задержка поллинга — настройки, а не только env', () => {
    for (const key of ['mango.adapter', 'mango.allowedIps', 'mango.statsPollDelayMs']) {
      expect(SETTING_SPECS, `${key}: нет в реестре настроек`).toHaveProperty(key);
    }
    // Каждый читатель обязан спрашивать настройку, а env оставлять запасным.
    expect(read('lib/telephony/mango/ip.ts')).toContain(
      "cachedIntegrationSetting('mango.allowedIps')"
    );
    expect(read('lib/telephony/mango/index.ts')).toContain(
      "cachedIntegrationSetting('mango.adapter')"
    );
    expect(read('worker/processors/mango-backfill.ts')).toContain(
      "cachedIntegrationSetting('mango.statsPollDelayMs')"
    );
  });

  it('смена адаптера сбрасывает кэш — иначе переключение ждёт перезапуска', () => {
    expect(read('server-actions/admin/integrationSettings.ts')).toContain('resetMangoAdapter()');
  });
});

describe('У-123: секреты вебхуков задаются из интерфейса', () => {
  it('все три секрета есть в реестре настроек', () => {
    for (const p of Object.values(WEBHOOK_PROVIDERS)) {
      expect(SETTING_SPECS, `${p.settingKey}: нет в реестре`).toHaveProperty(p.settingKey);
    }
  });

  it('роуты вебхуков сверяют секрет из настроек, а не из окружения', () => {
    const routes = {
      'app/api/integrations/telegram/webhook/route.ts': 'TELEGRAM_WEBHOOK_SECRET',
      'app/api/integrations/max/webhook/route.ts': 'MAX_WEBHOOK_SECRET',
      'app/api/integrations/whatsapp/webhook/route.ts': 'WHATSAPP_WEBHOOK_SECRET',
    };
    for (const [file, envVar] of Object.entries(routes)) {
      const src = read(file);
      expect(src, `${file}: секрет всё ещё читается из окружения`).not.toContain(
        `process.env.${envVar}`
      );
      expect(src, `${file}: секрет не берётся из настроек`).toContain('getSettingValue');
    }
  });

  it('индикатор «задан» читает базу, а не переменную сервера', () => {
    const src = read('app/admin/settings/integrations/page.tsx');
    for (const envVar of [
      'TELEGRAM_WEBHOOK_SECRET',
      'MAX_WEBHOOK_SECRET',
      'WHATSAPP_WEBHOOK_SECRET',
    ]) {
      expect(src, `индикатор ${envVar} снова смотрит в окружение`).not.toContain(
        `process.env.${envVar}`
      );
    }
    expect(src).toContain("byKey('telegram.webhookSecret').isSet");
  });

  it('кнопка регистрации не показывается там, где провайдер её не умеет', () => {
    // Кнопка, которая ничего не делает, хуже её отсутствия: человек решит,
    // что вебхук подключён.
    expect(WEBHOOK_PROVIDERS.whatsapp.canRegister).toBe(false);
    expect(WEBHOOK_PROVIDERS.telegram.canRegister).toBe(true);
  });

  it('соль Mango не попадает в генерируемые секреты — её выдаёт провайдер', () => {
    const keys = Object.values(WEBHOOK_PROVIDERS).map((p) => String(p.settingKey));
    expect(keys, 'mango.apiSalt нельзя генерировать на своей стороне').not.toContain(
      'mango.apiSalt'
    );
  });
});
