import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';
import { FEATURE_FLAGS, featureFlagEnvVar } from '@/lib/featureFlags';
import { ENV_ONLY, TOOL_ONLY } from './helpers/envRegistry';
import { collectEnvReads } from './helpers/envScan';

/**
 * `У-134` (закрывает `Д-39`): документация env синхронизирована с кодом.
 *
 * Обе стороны: (1) каждая переменная, которую читает код — буквально, как
 * fallback настройки (`SETTING_SPECS[*].envVar`) или как флаг
 * (`FEATURE_<ФЛАГ>`), — имеет строку в `.env.example`; (2) каждая строка
 * `.env.example` описывает известную переменную — мёртвые строки не копятся
 * (так там три месяца жила `FEATURE_PARTNER_LEADS` удалённого флага).
 * Плюс пометка: переменная-fallback переехавшей настройки обязана нести в
 * комментарии над собой слова «задаётся в интерфейсе» — человек со старым
 * `.env` должен понять, почему его значение больше ни на что не влияет.
 */
const EXAMPLE_PATH = join(__dirname, '..', '..', '.env.example');
const PROD_EXAMPLE_PATH = join(__dirname, '..', '..', '.env.production.example');

function exampleLines(): string[] {
  return readFileSync(EXAMPLE_PATH, 'utf-8').split('\n');
}

/** Строки вида `VAR=` или `# VAR=` → имя → номер строки (первое вхождение). */
function documentedVars(lines: string[]): Map<string, number> {
  const vars = new Map<string, number>();
  lines.forEach((line, i) => {
    const m = /^#?\s*([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m && !vars.has(m[1]!)) vars.set(m[1]!, i);
  });
  return vars;
}

function knownNames(): Set<string> {
  const names = new Set<string>([...Object.keys(ENV_ONLY), ...collectEnvReads().keys()]);
  for (const spec of Object.values(SETTING_SPECS)) if (spec.envVar) names.add(spec.envVar);
  for (const flag of FEATURE_FLAGS) names.add(featureFlagEnvVar(flag));
  return names;
}

describe('У-134: .env.example синхронизирован с кодом', () => {
  it('каждая переменная из кода задокументирована', () => {
    const documented = documentedVars(exampleLines());
    // TOOL_ONLY здесь же: реестр обещает, что инструментные переменные
    // задокументированы, — обещание без проверки уже подводило (`У-134`).
    // Заодно это ловит мёртвую запись TOOL_ONLY: строку убрали из примера —
    // убери и из реестра.
    const missing = [...knownNames(), ...Object.keys(TOOL_ONLY)]
      .filter((n) => !documented.has(n))
      .sort();
    expect(
      missing,
      'Код читает переменную, а .env.example о ней молчит — допиши строку ' +
        'с назначением (и пометкой «задаётся в интерфейсе», если это fallback ' +
        'переехавшей настройки):\n'
    ).toEqual([]);
  });

  it('в .env.example нет мёртвых строк', () => {
    const known = knownNames();
    const dead = [...documentedVars(exampleLines()).keys()]
      .filter((n) => !known.has(n) && !(n in TOOL_ONLY))
      .sort();
    expect(
      dead,
      '.env.example описывает переменную, которую не читает ни код, ни ' +
        'инструменты (TOOL_ONLY) — убери строку или, если это инструмент вне ' +
        'src/**, впиши её в TOOL_ONLY с причиной:\n'
    ).toEqual([]);
  });

  /**
   * Ищем маркер в непрерывном блоке комментариев прямо над строкой
   * переменной (другие `VAR=`-строки блок не рвут: переменные одного
   * раздела делят одну шапку).
   */
  function unmarkedSettingFallbacks(lines: string[]): string[] {
    const documented = documentedVars(lines);
    const unmarked: string[] = [];
    for (const spec of Object.values(SETTING_SPECS)) {
      if (!spec.envVar) continue;
      const at = documented.get(spec.envVar);
      if (at === undefined) continue; // полноту держат другие проверки
      let marked = false;
      for (let i = at - 1; i >= 0; i--) {
        const line = lines[i]!.trim();
        if (line === '') break;
        if (line.startsWith('#') && !/^#\s*[A-Z_][A-Z0-9_]*=/.test(line)) {
          if (line.includes('задаётся в интерфейсе') || line.includes('задаются в интерфейсе')) {
            marked = true;
            break;
          }
        }
      }
      if (!marked) unmarked.push(spec.envVar);
    }
    return [...new Set(unmarked)].sort();
  }

  it('fallback переехавшей настройки помечен «задаётся в интерфейсе»', () => {
    expect(
      unmarkedSettingFallbacks(exampleLines()),
      'Переменная переехала в настройки (SETTING_SPECS.envVar), но её блок в ' +
        '.env.example не говорит «задаётся в интерфейсе» — человек со старым ' +
        '.env не поймёт, почему значение не действует:\n'
    ).toEqual([]);
  });

  // Д-39 в реестре дефектов цитирует именно production-пример — без этих двух
  // проверок он продолжил бы гнить тем самым способом, против которого У-134.
  describe('.env.production.example — под тем же стражем', () => {
    const prodLines = () => readFileSync(PROD_EXAMPLE_PATH, 'utf-8').split('\n');

    it('нет мёртвых строк (полноты не требуем: это выжимка для production)', () => {
      const known = knownNames();
      const dead = [...documentedVars(prodLines()).keys()]
        .filter((n) => !known.has(n) && !(n in TOOL_ONLY))
        .sort();
      expect(
        dead,
        '.env.production.example описывает переменную, которую не читает ни ' +
          'код, ни инструменты:\n'
      ).toEqual([]);
    });

    it('fallback переехавшей настройки помечен и здесь', () => {
      expect(
        unmarkedSettingFallbacks(prodLines()),
        'Блок переменной в .env.production.example не говорит «задаётся в ' +
          'интерфейсе»:\n'
      ).toEqual([]);
    });
  });
});
