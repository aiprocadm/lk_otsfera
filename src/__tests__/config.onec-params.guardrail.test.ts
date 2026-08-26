import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';
import { ALL_SCHEDULES, SYNC_SCHEDULES, defaultPatternFor } from '@/lib/jobs/scheduling';
import { SYNC_ENTITIES } from '@/lib/services/admin/syncControl';
import { parseCron } from '@/lib/jobs/cron';

/**
 * Страж PR-3 этапа 4: параметры и расписания обмена с 1С правятся из
 * интерфейса (`У-125`), а дубля расписаний больше нет.
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('У-125: параметры обмена — настройки, а не только переменные сервера', () => {
  it('все шесть параметров есть в реестре настроек', () => {
    for (const key of [
      'onec.mode',
      'onec.httpTimeoutMs',
      'onec.cursorOverlapMinutes',
      'onec.defaultCompanyId',
      'onec.pendingMaxAttempts',
      'onec.pendingMaxAgeDays',
    ]) {
      expect(SETTING_SPECS, `${key}: нет в реестре настроек`).toHaveProperty(key);
    }
  });

  it('каждый читатель спрашивает настройку, а переменную оставляет запасной', () => {
    const src = read('lib/services/oneCSync/config.ts');
    // Проверяем КАЖДЫЙ параметр отдельно. «Где-то в файле есть чтение
    // настроек» проходило, даже когда один из шести читался только из
    // окружения, — поймано мутацией.
    const pairs: Array<[string, string]> = [
      ['onec.mode', 'ONE_C_MODE'],
      ['onec.httpTimeoutMs', 'ONE_C_HTTP_TIMEOUT_MS'],
      ['onec.cursorOverlapMinutes', 'ONE_C_CURSOR_OVERLAP_MINUTES'],
      ['onec.defaultCompanyId', 'ONE_C_COMPANY_ID'],
      ['onec.pendingMaxAttempts', 'ONE_C_PENDING_MAX_ATTEMPTS'],
      ['onec.pendingMaxAgeDays', 'ONE_C_PENDING_MAX_AGE_DAYS'],
    ];
    for (const [key, env] of pairs) {
      expect(src, `${key}: читается мимо настроек — интерфейс на него не влияет`).toContain(
        `configured('${key}', process.env.${env})`
      );
    }
  });

  it('числовые поля проверяются границами, а не сохраняются как есть', () => {
    // Таймаут в ноль миллисекунд тихо останавливает обмен, а человек ищет
    // причину в 1С.
    const src = read('server-actions/admin/syncControl.ts');
    expect(src, 'границы объявлены').toMatch(/min:\s*\d+,\s*max:\s*\d+/);
    // Объявить границы и не сравнить с ними — самый вероятный вид регресса:
    // слово `value_out_of_range` остаётся в типе, и проверка «есть такой код»
    // проходит. Поймано мутацией.
    expect(src, 'границы объявлены, но не проверяются').toMatch(
      /parsed < n\.min \|\| parsed > n\.max/
    );
  });

  it('переключение в боевой режим спрашивает подтверждение', () => {
    // Последствия видны не на экране, а в 1С: программа начнёт туда писать.
    const src = read('components/admin/one-c-params-form.tsx');
    expect(src).toContain('window.confirm');
  });
});

describe('У-125: расписание задаётся из интерфейса', () => {
  it('дубль расписаний удалён — источник один', () => {
    // `cronLabel` дублировал паттерн «только для UI», и его дрейф приходилось
    // стеречь отдельным тестом.
    for (const cfg of Object.values(SYNC_ENTITIES)) {
      expect(cfg, 'дубль расписания вернулся в SYNC_ENTITIES').not.toHaveProperty('cronLabel');
    }
    expect(read('lib/services/admin/syncControl.ts')).not.toContain("cronLabel: '");
  });

  it('общий реестр знает каждое расписание платформы', () => {
    const ids = new Set(ALL_SCHEDULES.map((s) => s.schedulerId));
    for (const cfg of Object.values(SYNC_ENTITIES)) {
      // Кроме тех, у кого расписания нет вовсе (ручной запуск).
      if (!ids.has(cfg.schedulerId)) continue;
      expect(defaultPatternFor(cfg.schedulerId), cfg.schedulerId).toBeTruthy();
    }
    expect(ids.size).toBeGreaterThanOrEqual(SYNC_SCHEDULES.length);
  });

  it('редактируемые расписания — ровно те, у которых есть свой экран', () => {
    // Остальные (комиссии, напоминания, ops-алерты) правятся своими
    // требованиями, а не «заодно»: иначе форма пообещала бы то, чего не делает.
    const editable = ALL_SCHEDULES.filter((s) => s.editable)
      .map((s) => s.schedulerId)
      .sort();
    expect(editable).toEqual(
      [
        ...SYNC_SCHEDULES.map((s) => s.schedulerId),
        // `У-130`: интервал задачи SLA настраивается на экране «SLA входящих».
        'monitoring.slaEscalation.cron',
      ].sort()
    );
  });

  it('все зашитые в коде расписания разбираются нашим же разбором', () => {
    // Иначе форма показала бы «ошибка» на том, что уже работает.
    for (const s of ALL_SCHEDULES) {
      expect(parseCron(s.pattern).ok, `${s.schedulerId}: ${s.pattern}`).toBe(true);
    }
  });

  it('воркер берёт расписания из базы, а не только из кода', () => {
    const src = read('worker/index.ts');
    expect(src, 'воркер снова регистрирует только зашитые расписания').toContain(
      'getSchedulePatterns(prisma)'
    );
    expect(src).toMatch(/registerSyncSchedules\(getQueue, pausedIds, patterns\)/);
  });

  it('регистрация умеет принять паттерн извне', () => {
    const src = read('lib/jobs/scheduling.ts');
    expect(src, 'registerSyncSchedules снова игнорирует переданные паттерны').toMatch(
      /patterns\.get\(schedule\.schedulerId\)/
    );
  });

  it('сохранение расписания проверяет и задачу, и само выражение', () => {
    const src = read('lib/services/admin/syncSchedules.ts');
    expect(src, 'принимается любая строка вместо cron').toContain('parseCron(trimmed)');
    expect(src, 'принимается любая задача').toContain('unknown_schedule');
  });

  it('испорченное значение в базе не останавливает обмен', () => {
    // База переживает и ручные правки; обмен важнее аккуратности строки.
    const src = read('lib/services/admin/syncSchedules.ts');
    expect(src).toMatch(/if \(!parseCron\(value\)\.ok\) continue;/);
  });
});
