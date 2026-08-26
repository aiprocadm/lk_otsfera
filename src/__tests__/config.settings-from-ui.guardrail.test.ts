import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Стражи PR-1 этапа 4 — три дефекта, которые чинятся здесь и должны остаться
 * починенными (`У-131`, `У-132`, `У-133`; дефекты `Д-35`, `Д-36`, `Д-37`).
 *
 * Проверяем ИСХОДНИК, а не поведение, там, где поведение проверить дёшево
 * нечем: вызов на старте процесса и обязательность переменной в схеме — это
 * ровно те места, откуда строчка исчезает при первом же рефакторинге и никто
 * этого не замечает.
 */
const SRC = join(__dirname, '..');
const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('У-133: снапшот флагов праймится до первого запроса (Д-37)', () => {
  it('старт процесса приложения праймит снапшот', () => {
    const src = read('instrumentation.ts');
    // Проверяем ВЫЗОВ, а не упоминание: удалить вызов, оставив функцию с
    // подходящим именем, — самый вероятный вид регресса (поймано мутацией).
    expect(src, 'instrumentation.ts объявил прайм, но не зовёт его').toMatch(
      /await primeFeatureFlagsOnBoot\(\);/
    );
    expect(src).toContain('primeFeatureFlagCache');
  });

  it('старт воркера праймит снапшот', () => {
    // У процессоров нет своей сессии, праймить снапшот некому.
    const src = read('worker/index.ts');
    expect(src, 'воркер перестал праймить флаги').toMatch(/await primeFeatureFlagCache\(prisma\);/);
  });

  it('все три до-сессионных роута входа праймят снапшот сами', () => {
    // Логин и 2FA работают ДО всякой сессии — именно поэтому флаг, включённый
    // в интерфейсе, там не действовал.
    for (const p of [
      'app/api/auth/login/route.ts',
      'app/api/auth/2fa/verify/route.ts',
      'app/api/auth/2fa/resend/route.ts',
    ]) {
      expect(read(p), `${p}: нет прайма снапшота флагов`).toContain(
        'await primeFeatureFlagCache(prisma)'
      );
    }
  });
});

describe('У-132: ключ шифрования обязателен и виден заранее (Д-36)', () => {
  it('APP_ENCRYPTION_KEY обязателен в production-схеме', () => {
    const src = read('lib/env.ts');
    expect(src, 'APP_ENCRYPTION_KEY пропал из production-схемы').toMatch(
      /APP_ENCRYPTION_KEY:\s*requiredSecret\(/
    );
  });

  it('страница интеграций предупреждает ДО попытки сохранить', () => {
    const src = read('app/admin/settings/integrations/page.tsx');
    expect(src).toContain('isSecretsKeyConfigured');
    expect(src, 'баннер об отсутствии ключа пропал').toContain('Сохранение секретов недоступно');
  });

  it('/api/health показывает состояние ключа', () => {
    const src = read('app/api/health/route.ts');
    // Проверяем, что состояние попало В ОТВЕТ, а не просто посчиталось в
    // переменную: объявить и не отдать — самый вероятный вид регресса
    // (поймано мутацией).
    expect(src, 'состояние ключа считается, но в ответ не попадает').toMatch(
      /checks:\s*\{[^}]*secretsKey/
    );
    expect(src).toContain('isSecretsKeyConfigured');
  });

  it('ключ описан в обоих примерах окружения', () => {
    for (const f of ['.env.example', '.env.production.example']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f}: APP_ENCRYPTION_KEY не описан`).toContain('APP_ENCRYPTION_KEY');
    }
  });
});

describe('У-131: заданное в интерфейсе значение можно вернуть к серверному (Д-35)', () => {
  it('действие сброса существует и проверяет ключ по реестру', () => {
    const src = read('server-actions/admin/integrationSettings.ts');
    expect(src).toContain('resetSettingToServerValueAction');
    // Чужая строка из формы не должна удалять произвольную запись настроек.
    expect(src, 'сброс не проверяет ключ по реестру').toContain('in SETTING_SPECS');
  });

  it('кнопка сброса показывается только при реальном перекрытии', () => {
    const src = read('components/admin/integration-settings-form.tsx');
    expect(src).toContain('ResetSettingButton');
    expect(src, 'кнопка сброса показывается и там, где перекрытия нет').toContain("=== 'db'");
  });

  it('идентификатор канала WhatsApp — не секрет', () => {
    // Это адрес, а не секрет: пока он был помечен секретом, форма его не
    // показывала и проверить подключённый канал было нельзя.
    const src = read('lib/config/integrationSettings.ts');
    const start = src.indexOf("  'whatsapp.channelId': {");
    expect(start, 'запись whatsapp.channelId пропала из реестра').toBeGreaterThan(-1);
    // Режем РОВНО по концу записи. Срез «первые N символов» захватывал
    // соседнюю настройку, и её `isSecret: false` делал проверку зелёной
    // всегда — поймано мутацией.
    const block = src.slice(start, src.indexOf('\n  },', start));
    expect(block, 'идентификатор канала снова помечен секретом').toContain('isSecret: false');
    expect(block).not.toContain('isSecret: true');
  });
});
