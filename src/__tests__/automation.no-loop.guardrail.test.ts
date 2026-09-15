import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  entitiesTouchedByActions,
  entitiesWatchedByTriggers,
} from '@/lib/automation/catalog';

/**
 * СТРАЖ решения `Р-Б-6`: действия правил не порождают триггеры.
 *
 * Это главный риск всего этапа. Правило создаёт задачу → задача рождает
 * событие → событие снова запускает правило → и так до тех пор, пока кто-нибудь
 * не заметит тысячу задач. Заметить при этом тяжело: каждый отдельный шаг
 * выглядит правильно.
 *
 * Требование §5 ТЗ — закрепить это тестом **до первого правила из коробки**.
 * Здесь он и написан: движка ещё нет, каталоги только появились.
 *
 * Три независимых заслона, каждый проверяется отдельно:
 *
 *  1. **Каталоги не пересекаются.** Ни одно действие не меняет сущность, за
 *     которой следит хоть один триггер.
 *  2. **Действия физически не могут испустить событие** — файл действий не
 *     импортирует диспетчер (дублируется правилом dependency-cruiser, чтобы
 *     нарушение красило сборку, а не ждало ревью).
 *  3. **Диспетчер отбрасывает событие, помеченное как порождённое правилом** —
 *     страховка на будущее: когда каталог действий расширят, первые два
 *     заслона придётся пересматривать сознательно, а этот сработает сам.
 *
 * Мутация (проверено 15.09.2026): добавить в `AUTOMATION_ACTIONS` действие с
 * `touches: ['order']` → первый тест краснеет.
 */

const ROOT = process.cwd();

describe('страж: правила не могут запустить сами себя (`Р-Б-6`)', () => {
  it('ни одно ДЕЙСТВИЕ не трогает сущность, за которой следит ТРИГГЕР', () => {
    const touched = entitiesTouchedByActions();
    const watched = entitiesWatchedByTriggers();
    const overlap = [...touched].filter((e) => watched.has(e));
    expect(
      overlap,
      `действия меняют ${overlap.join(', ')}, а за этим следят триггеры — правило запустит само себя`
    ).toEqual([]);
  });

  it('каталоги непустые — иначе первая проверка зелена бессмысленно', () => {
    // Пустое множество не пересекается ни с чем. Без этой проверки стереть
    // каталог действий было бы «способом починить» страж.
    expect(Object.keys(AUTOMATION_ACTIONS).length).toBeGreaterThan(0);
    expect(Object.keys(AUTOMATION_TRIGGERS).length).toBeGreaterThan(0);
    expect(entitiesTouchedByActions().size).toBeGreaterThan(0);
    expect(entitiesWatchedByTriggers().size).toBeGreaterThan(0);
  });

  it('у каждого действия объявлено, что именно оно меняет', () => {
    for (const [key, spec] of Object.entries(AUTOMATION_ACTIONS)) {
      expect(spec.touches.length, `действие ${key} не говорит, что меняет`).toBeGreaterThan(0);
    }
  });

  it('файл действий НЕ импортирует диспетчер событий', () => {
    // Второй заслон. Даже если каталоги однажды разойдутся, действие не сможет
    // испустить событие: у него нет доступа к диспетчеру.
    //
    // Читаем через `readSource` — он снимает комментарии. Иначе страж ловит
    // собственное пояснение в шапке файла действий: там это слово написано
    // ровно затем, чтобы объяснить запрет.
    const actions = readSource(join(ROOT, 'src/lib/automation/actions.ts'));
    expect(actions).not.toContain('emitAutomationEvent');
    expect(actions).not.toContain("from './dispatch'");
    expect(actions).not.toContain("from '@/lib/automation/dispatch'");
  });

  it('правило dependency-cruiser запрещает этот импорт механически', () => {
    // Комментарий в коде забывают, правило сборки — нет.
    //
    // Конфиг ЗАГРУЖАЕТСЯ, а не читается текстом. Разница принципиальная:
    // закомментированное правило в тексте нашлось бы, а сборку не защищало бы
    // — ровно то слепое пятно, ради которого в проекте появился `readSource`.
    // Загруженный конфиг показывает действующие правила, а не намерения.
    const require = createRequire(import.meta.url);
    const config = require(join(ROOT, '.dependency-cruiser.cjs')) as {
      forbidden: Array<{ name: string; severity: string; from: unknown; to: unknown }>;
    };
    const rule = config.forbidden.find((r) => r.name === 'automation-actions-cannot-emit');
    expect(rule, 'правило пропало из .dependency-cruiser.cjs').toBeDefined();
    // `warn` вместо `error` означал бы, что нарушение не красит сборку.
    expect(rule?.severity).toBe('error');
  });

  it('диспетчер отбрасывает событие, помеченное как порождённое правилом', () => {
    const dispatch = readSource(join(ROOT, 'src/lib/automation/dispatch.ts'));
    // Третий заслон объявлен в коде, а не только на словах.
    expect(dispatch).toContain("source === 'automation'");
  });
});
