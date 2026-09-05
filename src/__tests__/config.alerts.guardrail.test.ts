import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';

/**
 * Страж PR-4 этапа 4: ops-оповещения настраиваются из интерфейса (`У-126`).
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('У-126: пороги и канал оповещений — настройки', () => {
  it('все девять ключей есть в реестре', () => {
    for (const key of [
      'alerts.queueWaitingMax',
      'alerts.dlqMax',
      'alerts.syncLagMaxHours',
      'alerts.renotifyCooldownHours',
      'alerts.oneCDeadLetterMax',
      // `У-174`: предел документов, которые 1С не приняла.
      'alerts.oneCPushFailedMax',
      'alerts.telegramBotToken',
      'alerts.telegramChatId',
      'alerts.emailRecipients',
    ]) {
      expect(SETTING_SPECS, `${key}: нет в реестре настроек`).toHaveProperty(key);
    }
  });

  it('токен бота помечен секретом, адрес чата — нет', () => {
    // Адрес чата — не секрет: пока он спрятан, проверить, тот ли чат
    // подключён, нельзя (та же ошибка, что была с каналом WhatsApp).
    expect(SETTING_SPECS['alerts.telegramBotToken'].isSecret).toBe(true);
    expect(SETTING_SPECS['alerts.telegramChatId'].isSecret).toBe(false);
  });

  it('у списка получателей нет выдуманной переменной окружения', () => {
    // Её никогда не было. Придумать имя значило бы соврать реестру и сбить
    // стражи `У-122`/`У-134`, которые сверяют реестр с `.env.example`.
    expect(SETTING_SPECS['alerts.emailRecipients'].envVar).toBeNull();
  });

  it('каждый порог читается из настройки, а переменная остаётся запасной', () => {
    const src = read('lib/monitoring/thresholds.ts');
    const pairs: Array<[string, string]> = [
      ['alerts.queueWaitingMax', 'ALERT_QUEUE_WAITING_MAX'],
      ['alerts.dlqMax', 'ALERT_DLQ_MAX'],
      ['alerts.syncLagMaxHours', 'ALERT_SYNC_LAG_MAX_HOURS'],
      ['alerts.renotifyCooldownHours', 'ALERT_RENOTIFY_COOLDOWN_HOURS'],
      ['alerts.oneCDeadLetterMax', 'ALERT_ONEC_DEADLETTER_MAX'],
      ['alerts.oneCPushFailedMax', 'ALERT_ONEC_PUSH_FAILED_MAX'],
    ];
    for (const [key, env] of pairs) {
      expect(src, `${key}: читается мимо настроек — интерфейс на него не влияет`).toContain(
        `configured('${key}', env.${env})`
      );
    }
  });

  it('доставка берёт бота и чат из настроек', () => {
    const src = read('lib/monitoring/deliver.ts');
    expect(src).toContain("cachedIntegrationSetting('alerts.telegramBotToken')");
    expect(src).toContain("cachedIntegrationSetting('alerts.telegramChatId')");
    // Переменные не удалены: старый .env обязан продолжать работать.
    expect(src).toContain('process.env.ALERT_TELEGRAM_BOT_TOKEN');
    expect(src).toContain('process.env.ALERT_TELEGRAM_CHAT_ID');
  });

  it('пустой список получателей сохраняет прежнее поведение — всем админам', () => {
    // Иначе включение формы молча отняло бы оповещения у тех, кто их получал.
    const src = read('lib/monitoring/deliver.ts');
    expect(src).toMatch(/emails\.length === 0/);
    expect(src).toContain("role: 'admin', isActive: true");
  });

  it('пороги проверяются границами, а не сохраняются как есть', () => {
    // Ноль часов до повторного уведомления — это письмо каждые пять минут.
    const src = read('server-actions/admin/alerts.ts');
    expect(src, 'границы объявлены').toMatch(/min:\s*\d+,\s*max:\s*[\d_]+/);
    expect(src, 'границы объявлены, но не проверяются').toMatch(
      /parsed < n\.min \|\| parsed > n\.max/
    );
  });

  it('опечатка в адресе отклоняется, а не уходит «в никуда»', () => {
    const src = read('server-actions/admin/alerts.ts');
    expect(src).toContain('EMAIL_RE');
    expect(src, 'адреса не проверяются').toMatch(/!EMAIL_RE\.test\(e\)/);
  });

  it('тестовая отправка идёт тем же путём, что настоящая', () => {
    // Своя «проверочная» отправка проверяла бы саму себя, а не доставку.
    const src = read('server-actions/admin/alerts.ts');
    expect(src).toContain('deliverAlert(prisma');
    // И честно помечена как проверка — иначе дежурный решит, что авария.
    expect(src).toContain('Это не авария');
  });

  it('история сработавших алертов показывается на том же экране', () => {
    // Отдельной таблицы не заводили: `AlertState` хранит и разрешённые записи
    // с датами первого срабатывания и разрешения — это и есть история.
    const page = read('app/admin/settings/system/health/page.tsx');
    expect(page).toContain('<AlertsSection');
    expect(page).toContain('<AlertSettingsForm');
    const section = read('components/admin/alerts-section.tsx');
    expect(section, 'из истории пропала дата первого срабатывания').toContain(
      'Первое срабатывание'
    );
    expect(section, 'из истории пропала дата разрешения').toContain('resolvedAt');
  });
});
