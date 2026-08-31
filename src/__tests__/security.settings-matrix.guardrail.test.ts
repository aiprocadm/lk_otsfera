import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * Страж матрицы «раздел хаба × роль» (`У-135`, решение `Р-22`).
 *
 * Матрица — это решение заказчика о власти: что руководитель компании видит и
 * правит, а что остаётся только за администратором платформы. Разъезжается она
 * тихо — кто-то добавит `'leader'` в cabinets «чтобы посмотреть», и секреты
 * платформы окажутся на расстоянии одной страницы.
 *
 * Двухсторонняя проверка: и «руководитель получил всё, что обещано», и
 * «руководитель НЕ получил ничего сверх». Односторонний список ловил бы только
 * половину регрессов.
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/**
 * Решение `Р-22` дословно. Разделы этапов 5–6 (каталог, шаблоны документов)
 * добавляются сюда ТЕМ ЖЕ PR, что их заводит, — так написано в `У-135`.
 */
const LEADER_SECTIONS = [
  'personal.settings', // свои данные — у всех
  'integrations.overview', // светофор и чек-листы, БЕЗ секретов платформы
  'integrations.oneC', // обмен в объёме компании: файлы, история, автообмен на чтение
  'catalogs.slaIntake', // SLA своей компании (`У-130`)
  'catalogs.emailTemplates', // тексты писем своей компании (`У-128`)
  'catalogs.applicationStatuses',
  'catalogs.notificationRules', // правила уведомлений компании (`У-127`)
  'catalogs.customFields',
  // `У-136`/`Р-22`: каталог услуг и цен СВОЕЙ компании — границу держит сервис;
  // раздел этапа 5 добавлен тем же PR, что его завёл (так велит `У-135`).
  'catalogs.priceList',
  // `У-160`/`Р-22`: тексты договора СВОЕЙ компании — раздел этапа 6 добавлен
  // тем же PR, что его завёл (так велит `У-135`).
  'catalogs.documentTemplates',
  'catalogs.requisites', // реквизиты исполнителя СВОЕЙ компании
  'access.roles',
] as const;

/** Только администратор: секреты платформы, надзор, вход, здоровье. */
const ADMIN_ONLY_SECTIONS = [
  'security.loginPolicies', // вход один на всю систему
  'security.audit',
  'security.personalData',
  'system.health',
  'system.featureFlags',
] as const;

describe('У-135: матрица «раздел × роль» соответствует Р-22', () => {
  it('руководитель видит ровно обещанные разделы — не меньше', () => {
    for (const id of LEADER_SECTIONS) {
      const section = SETTINGS_SECTIONS.find((s) => s.id === id);
      expect(section, `${id}: раздел пропал из реестра`).toBeDefined();
      expect(section?.cabinets, `${id}: у руководителя отняли обещанный раздел`).toContain(
        'leader'
      );
    }
  });

  it('и не больше: всё остальное — только администратор', () => {
    const leaderSet = new Set<string>(LEADER_SECTIONS);
    const extra = SETTINGS_SECTIONS.filter(
      (s) => s.cabinets.includes('leader') && !leaderSet.has(s.id)
    ).map((s) => s.id);
    expect(
      extra,
      'Руководителю открыли раздел вне матрицы Р-22. Либо это решение заказчика — ' +
        'тогда допишите его в LEADER_SECTIONS с причиной, либо это утечка власти:\n' +
        extra.join('\n')
    ).toEqual([]);
  });

  it('админ-только разделы не открыты никому, кроме администратора', () => {
    for (const id of ADMIN_ONLY_SECTIONS) {
      const section = SETTINGS_SECTIONS.find((s) => s.id === id);
      expect(section, `${id}: раздел пропал из реестра`).toBeDefined();
      expect(section?.cabinets, `${id}: секретный раздел открыли не-администратору`).toEqual([
        'admin',
      ]);
    }
  });

  it('матрица покрывает КАЖДЫЙ раздел реестра', () => {
    // Новый раздел обязан попасть либо в список руководителя, либо в
    // админ-только — молча он не появляется.
    const known = new Set<string>([...LEADER_SECTIONS, ...ADMIN_ONLY_SECTIONS]);
    const unlisted = SETTINGS_SECTIONS.filter((s) => !known.has(s.id)).map((s) => s.id);
    expect(
      unlisted,
      'Раздел не расписан в матрице У-135. Ответьте на вопрос «видит ли его ' +
        'руководитель?» и допишите в нужный список:\n' +
        unlisted.join('\n')
    ).toEqual([]);
  });
});

describe('У-135: секреты платформы и параметры 1С закрыты от руководителя на уровне API', () => {
  /**
   * Файлы действий, работающих с секретами платформы и параметрами подключения
   * 1С. Каждый экспорт обязан начинаться с требования админа — гард раздела с
   * cabinet='admin' тоже годится: он резолвится в requireAdmin.
   */
  const SECRET_ACTION_FILES = [
    'server-actions/admin/integrationSettings.ts',
    'server-actions/admin/loginPolicies.ts',
    'server-actions/admin/alerts.ts',
  ];

  /** В syncControl руководителю разрешён ровно ручной запуск — секретов там нет. */
  const SYNC_CONTROL_LEADER_ALLOWED = new Set(['triggerSyncAction']);

  /**
   * Комментарии вырезаются ДО разбора: закомментированный `// await
   * requireAdmin();` не должен засчитываться за гард (класс teamMode, §16).
   * Хвосты строк с `//` внутри (URL) тоже теряются — для поиска гарда это
   * безвредно.
   */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  // Обе допустимые формы действия: `export async function x` и
  // `export const x = async` — вторую прежний страж не видел вовсе.
  const EXPORT_ACTION_RE = /^export (?:async function (\w+)|const (\w+)\s*=\s*async)/gm;

  function exportedActions(code: string): Array<{ name: string; start: number }> {
    return [...code.matchAll(EXPORT_ACTION_RE)].map((m) => ({
      name: (m[1] ?? m[2])!,
      start: m.index,
    }));
  }

  function actionBody(code: string, actions: Array<{ start: number }>, i: number): string {
    const next = actions[i + 1];
    return code.slice(actions[i]!.start, next ? next.start : undefined);
  }

  it('каждое действие с секретами требует администратора', () => {
    const offenders: string[] = [];
    for (const file of SECRET_ACTION_FILES) {
      const code = stripComments(read(file));
      const actions = exportedActions(code);
      actions.forEach(({ name }, i) => {
        const body = actionBody(code, actions, i);
        const guarded =
          body.includes('requireAdmin()') ||
          /requireSettingsSection\('[^']+',\s*'admin'\)/.test(body);
        if (!guarded) offenders.push(`${file} → ${name}`);
      });
    }
    expect(
      offenders,
      'Действие с секретами платформы не требует администратора — руководитель ' +
        'дотянется до них через API:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('в syncControl всё админское, кроме явно разрешённого запуска', () => {
    const code = stripComments(read('server-actions/admin/syncControl.ts'));
    const actions = exportedActions(code);
    const offenders: string[] = [];
    actions.forEach(({ name }, i) => {
      if (SYNC_CONTROL_LEADER_ALLOWED.has(name)) return;
      if (!actionBody(code, actions, i).includes('requireAdmin()')) offenders.push(name);
    });
    expect(
      offenders,
      'Управление обменом с 1С открылось не-администратору:\n' + offenders.join('\n')
    ).toEqual([]);
  });

  it('шаблоны email-настроек: секреты не покидают сервер даже для админа', () => {
    // `getSettingsView` маскирует секреты (value: null) — руководителю и
    // подавно нечего читать. Проверяем, что маскировка на месте.
    const src = read('lib/config/integrationSettings.ts');
    expect(src, 'секреты перестали маскироваться в выдаче формы').toMatch(
      /value: spec\.isSecret \? null :/
    );
  });
});
