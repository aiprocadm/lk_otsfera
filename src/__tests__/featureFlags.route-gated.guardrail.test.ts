import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  FEATURE_FLAGS,
  FEATURE_PREFIXES,
  isRouteGatedFlag,
  type FeatureFlag,
} from '@/lib/featureFlags';
import { SENSITIVE_FLAGS } from '@/lib/services/admin/featureFlags';
import { readSource } from './helpers/source';

/**
 * Страж границы «что можно переключать из интерфейса» (`У-65`, этап 8).
 *
 * Флаг, который читает middleware, переключать из базы нельзя: middleware
 * работает в edge-среде, где базы нет, и включение из интерфейса было бы
 * иллюзией управления. Граница проходит ровно по `FEATURE_PREFIXES`, и
 * список обязан быть ОДИН: если middleware заведёт свою копию, экран начнёт
 * предлагать переключатели, которые ничего не делают.
 */
describe('граница route-флагов (У-65)', () => {
  it('middleware не держит собственной копии списка префиксов', () => {
    const src = readSource(join(process.cwd(), 'src/middleware.ts'));
    expect(src).toContain('FEATURE_PREFIXES');
    // Объявление живёт в featureFlags.ts — middleware только импортирует.
    expect(src).not.toMatch(/const\s+FEATURE_PREFIXES\s*[:=]/);
  });

  it('гейт бежит ИМЕННО по импортированному списку, а не по своей выборке', () => {
    // Прежней проверки мало: копия под другим именем
    // (`const GATED = FEATURE_PREFIXES.filter(...)`) оставляла импорт
    // использованным, поэтому её не видели ни страж, ни линтер, ни knip.
    // А раздел с выключенным флагом при этом снова открывался по прямой
    // ссылке (прогон №28). Проверяем то, что важно: цикл гейтинга идёт по
    // самому списку, и рядом с ним стоит отказ 404.
    const src = readSource(join(process.cwd(), 'src/middleware.ts'));
    const loop = /for\s*\(\s*const\s*\{[^}]*\}\s*of\s*FEATURE_PREFIXES\s*\)([\s\S]{0,400})/.exec(
      src
    );
    expect(loop, 'цикл гейтинга не идёт по FEATURE_PREFIXES').not.toBeNull();
    expect(loop![1], 'в цикле нет проверки флага').toContain('isFeatureEnabled(');
    expect(loop![1], 'в цикле нет отказа 404').toContain('404');
  });

  it('каждый флаг из префиксов помечен как непереключаемый', () => {
    for (const { flag } of FEATURE_PREFIXES) {
      expect(isRouteGatedFlag(flag), `${flag} закрывает раздел`).toBe(true);
    }
  });

  it('флаги вне префиксов переключаемы — иначе экран потерял бы смысл', () => {
    const gated = new Set(FEATURE_PREFIXES.map((p) => p.flag));
    const editable = FEATURE_FLAGS.filter((f) => !gated.has(f));
    expect(editable.length).toBeGreaterThan(0);
    for (const flag of editable) {
      expect(isRouteGatedFlag(flag), `${flag} не закрывает раздел`).toBe(false);
    }
  });

  it('опасные флаги существуют и перечислены осознанно (У-68)', () => {
    // Список не должен молча распухнуть: подтверждение на каждый флаг обесценит
    // подтверждение вообще.
    expect(SENSITIVE_FLAGS.length).toBeLessThanOrEqual(6);
    for (const flag of SENSITIVE_FLAGS) {
      expect(FEATURE_FLAGS).toContain(flag as FeatureFlag);
    }
  });

  /**
   * Прогон сопровождения №38 (`С-2`): `У-68` говорит о КЛАССЕ — «флаги, влияющие
   * на доступ и деньги», — а в скобках даёт примеры на 08.08.2026. `✅` стоял
   * по примерам, и под класс подпавшие `staff_2fa` (вход сотрудников) и
   * `document_generation` (счета и акты) переключались одним щелчком.
   * Перечисление не доказывает требование про класс — поэтому правило: КАЖДЫЙ
   * переключаемый флаг либо опасный, либо явно обычный с причиной. Новый флаг
   * без решения валит этот тест.
   */
  const ORDINARY_FLAGS: Partial<Record<FeatureFlag, string>> = {
    pwa_installer: 'подсказка установить приложение — доступ и деньги не трогает',
    chat: 'переписка клиента с менеджером — раздел, не права и не деньги',
    max_channel: 'канал мессенджера — без бота молчит',
    whatsapp_channel: 'канал мессенджера — без агрегатора молчит',
    notif_queue: 'способ доставки уведомлений (очередь), а не их содержание',
    inbound_messaging: 'приём входящих сообщений — раздел переписки',
    telephony_mango: 'журнал звонков — без АТС молчит',
    contacts: 'справочник контактов — раздел, права не меняет',
    bitrix_migration: 'раздел переноса — ничего не делает без пакета администратора',
    comm_center: 'шаблоны ответов и заявки с сайта — без токена формы молчит',
    automation: 'правила из коробки выключены — робот без отметки человека не работает',
    notification_center: 'экран уведомлений и дайджест по подписке',
    staff_chat: 'чат команды — переписка сотрудников',
    staff_calendar: 'календарь сотрудников',
    global_search: 'поиск ищет только в том, что роли уже видно',
    cabinet_questions: 'кнопка «Задать вопрос» — переписка, не права и не деньги',
  };

  it('каждый переключаемый флаг осознанно отнесён к опасным или обычным (У-68)', () => {
    const sensitive = new Set<FeatureFlag>(SENSITIVE_FLAGS);
    for (const flag of FEATURE_FLAGS.filter((f) => !isRouteGatedFlag(f))) {
      const ordinary = ORDINARY_FLAGS[flag] !== undefined;
      expect(
        sensitive.has(flag) !== ordinary,
        `${flag}: реши, трогает ли он доступ или деньги — и внеси в SENSITIVE_FLAGS ` +
          '(с текстом последствия) или в ORDINARY_FLAGS этого теста (с причиной)'
      ).toBe(true);
    }
  });

  it('вход сотрудников и выпуск счетов — опасные (У-68, прогон №38)', () => {
    expect(SENSITIVE_FLAGS).toContain('staff_2fa');
    expect(SENSITIVE_FLAGS).toContain('document_generation');
  });
});
