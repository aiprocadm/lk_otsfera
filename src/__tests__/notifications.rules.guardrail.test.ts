import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { ROUTABLE_CHANNELS } from '@/lib/notifications/routing';

/**
 * Страж PR-5 этапа 4: правила уведомлений действительно применяются (`У-127`).
 *
 * Экран, который сохраняет правила, но не влияет на доставку, — худший исход:
 * человек видит переключатели, а письма ходят как раньше.
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Файлы, которые рассылают уведомления и обязаны спрашивать правила. */
const FANOUT_FILES = [
  'lib/notifications/manager.ts',
  'lib/notifications/org.ts',
  'lib/notifications/partner.ts',
];

describe('У-127: правила применяются, а не только сохраняются', () => {
  it('каждая рассылка спрашивает правила', () => {
    for (const f of FANOUT_FILES) {
      expect(read(f), `${f}: рассылка не спрашивает правила маршрутизации`).toContain(
        'allowedChannels('
      );
    }
  });

  it('результат правил доходит до отправки, а не остаётся в переменной', () => {
    // Посчитать и не передать — самый вероятный вид регресса: экран работает,
    // доставка нет.
    for (const f of FANOUT_FILES) {
      expect(read(f), `${f}: правила посчитаны, но в доставку не переданы`).toContain(
        'routed ? { channels: routed } : {}'
      );
    }
  });

  it('правила спрашиваются ОДИН раз на рассылку, а не на каждого получателя', () => {
    // Иначе на сотне получателей — сотня запросов об одном и том же.
    for (const f of FANOUT_FILES) {
      const src = read(f);
      const calls = (src.match(/await allowedChannels\(/g) ?? []).length;
      const dispatches = (src.match(/await dispatchToRecipient\(/g) ?? []).length;
      expect(calls, `${f}: запросов правил больше, чем рассылок`).toBeLessThanOrEqual(dispatches);
    }
  });

  it('рассылка заказчику учитывает компанию — иначе правила чужой компании', () => {
    const src = read('lib/notifications/org.ts');
    expect(src).toContain('companyId: org.companyId');
    // Компания обязана быть в выборке организации, иначе будет undefined.
    expect(src, 'companyId не запрашивается у организации').toMatch(/companyId: true/);
  });
});

describe('У-127: область правки задаёт роль, а не форма', () => {
  it('компания берётся из сессии, а не из аргументов', () => {
    // Иначе руководитель одной компании переписал бы правила другой.
    const src = read('server-actions/admin/notificationRules.ts');
    expect(src).toContain('session.companyId');
    expect(src, 'компания принимается снаружи').not.toMatch(/companyId: string[,)]/);
  });

  it('руководитель без компании не правит платформу', () => {
    // Пустая область означала бы «правлю платформу» — тихое повышение прав.
    const src = read('server-actions/admin/notificationRules.ts');
    expect(src).toContain('if (!companyId) return { ok: false }');
  });

  it('ключи сверяются с реестром, а не принимаются как есть', () => {
    const src = read('server-actions/admin/notificationRules.ts');
    expect(src).toContain('Object.hasOwn(NOTIFICATION_TYPES, eventType)');
    expect(src).toContain('isKnownAudience(audience)');
    expect(src).toContain('isRoutableChannel(channel)');
  });

  it('«вернуть стандартные» удаляет переопределения, а не копирует код', () => {
    // Копия заморозила бы правила: реестр менялся бы, экран — нет.
    const src = read('server-actions/admin/notificationRules.ts');
    expect(src).toContain('notificationRule.deleteMany');
    expect(src, 'сброс задевает чужую область').toContain('where: { companyId: scope.companyId }');
  });
});

describe('У-127: экран заведён в реестре разделов', () => {
  it('раздел есть у администратора и руководителя', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.notificationRules');
    expect(section, 'раздел пропал из реестра — в меню его не будет').toBeDefined();
    expect(section?.cabinets).toEqual(['admin', 'leader']);
  });

  it('обе страницы зовут гард раздела, а не только скрывают пункт меню', () => {
    // Скрытая карточка — это внешний вид, а не защита (§4).
    for (const cabinet of ['admin', 'leader']) {
      const src = read(`app/${cabinet}/settings/catalogs/notification-rules/page.tsx`);
      expect(src, `${cabinet}: страница без гарда раздела`).toContain(
        "requireSettingsSection('catalogs.notificationRules'"
      );
    }
  });

  it('экран честно говорит, что уведомление в кабинете не отключается', () => {
    const src = read('components/settings/notification-rules-table.tsx');
    expect(src).toContain('не отключается');
    // И в правилах его действительно нет.
    expect(ROUTABLE_CHANNELS as readonly string[]).not.toContain('inapp');
  });
});
