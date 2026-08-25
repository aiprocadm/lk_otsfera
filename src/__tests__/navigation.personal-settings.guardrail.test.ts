import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSONAL_SETTINGS_TABS, personalSettingsTabsFor } from '@/lib/navigation/personalSettings';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * Страж личных настроек (`У-114`, правило зеркала §0.2).
 *
 * Один и тот же набор — привязка Telegram, каналы уведомлений, внутренний
 * номер, коды восстановления, сессии — жил в пяти кабинетах по-разному: у
 * менеджера одной длинной страницей, у партнёра своими вкладками
 * (`partner/settings-tabs.tsx`), у заказчика вперемешку с реквизитами
 * организации, у админа и руководителя — двумя разными разделами хаба в двух
 * разных группах. Человек, сменивший кабинет, искал своё заново.
 *
 * Разъезжается это тихо: достаточно завести в одном кабинете «свою маленькую»
 * навигацию, и через месяц наборы уже разные. Поэтому проверяем не внешний вид,
 * а источник: экран настроек каждого кабинета обязан собираться общим
 * компонентом, а названия вкладок — жить только в реестре.
 */
const SRC = join(__dirname, '..');

/** Экраны личных настроек всех пяти кабинетов. */
const SCREENS = [
  'app/manager/settings/page.tsx',
  'app/partner/settings/page.tsx',
  'app/organization/settings/page.tsx',
  // Админ и руководитель — раздел хаба; вся начинка в общем компоненте.
  'components/settings/staff-personal-settings.tsx',
];

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Код без комментариев: блочных и до конца строки. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

describe('личные настройки собираются одним компонентом (У-114)', () => {
  it('каждый кабинет берёт общий переключатель, а не рисует свой', () => {
    // Проверяем именно ОТРИСОВКУ общего переключателя: одного импорта мало —
    // его легко оставить, а рядом нарисовать свои вкладки.
    const rogue = SCREENS.filter((f) => !/<PersonalSettings[\s/>]/.test(read(f)));
    expect(rogue, 'экраны со своей навигацией по настройкам').toEqual([]);
  });

  it('названия вкладок нигде не переписаны руками — только реестр', () => {
    const labels = PERSONAL_SETTINGS_TABS.map((t) => t.label);
    const hardcoded: string[] = [];
    for (const file of SCREENS) {
      // Комментарии вырезаем: они законно называют вкладки по именам, объясняя,
      // что происходит. Проверяем только то, что реально попадёт на экран, —
      // и строковый литерал, и голый текст внутри разметки.
      const src = stripComments(read(file));
      for (const label of labels) {
        if (src.includes(label)) hardcoded.push(`${file}: ${label}`);
      }
    }
    expect(hardcoded, 'подпись вкладки, написанная в кабинете вместо реестра').toEqual([]);
  });

  it('«Команда» есть только там, где ею управляют', () => {
    expect(personalSettingsTabsFor().map((t) => t.key)).toEqual([
      'profile',
      'notifications',
      'security',
    ]);
    expect(personalSettingsTabsFor({ team: true }).map((t) => t.key)).toEqual([
      'profile',
      'team',
      'notifications',
      'security',
    ]);
  });

  it('у каждой вкладки есть строка «что здесь делают» (§15)', () => {
    for (const tab of PERSONAL_SETTINGS_TABS) {
      expect(tab.description.length, tab.key).toBeGreaterThan(20);
    }
  });
});

describe('в хабе личные настройки — один раздел (У-114)', () => {
  const personal = SETTINGS_SECTIONS.filter((s) => s.group === 'personal');

  it('ровно один раздел, и он есть у обоих кабинетов сотрудников ЦО', () => {
    expect(personal.map((s) => s.id)).toEqual(['personal.settings']);
    expect([...(personal[0]?.cabinets ?? [])].sort()).toEqual(['admin', 'leader']);
  });

  it('прежние два раздела не вернулись — иначе набор снова разъедется', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(ids).not.toContain('integrations.notifications');
    expect(ids).not.toContain('security.personal');
  });

  it('право на свои настройки нельзя отнять разметкой профиля доступа', () => {
    // `'own'` — «право быть собой». Иначе сотрудник с размеченным профилем не
    // смог бы отвязать собственный Telegram или закрыть чужую сессию.
    expect(personal[0]?.capability).toBe('own');
  });
});
