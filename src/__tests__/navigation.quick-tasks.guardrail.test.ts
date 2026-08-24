import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Флаги включаем все: страж проверяет ВЕСЬ реестр плиток, а не тот срез,
// который случайно виден при текущих настройках.
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: () => true }));

import { quickTasksFor, type QuickTasksRole } from '@/lib/quickTasks';

/**
 * Страж «частых задач» (`У-105`).
 *
 * Плитка стартового экрана отвечает на вопрос «что делать дальше» (§15).
 * Плитка, которая обещает действие и ведёт на экран без этой кнопки, — тупик:
 * человек нажимает «Добавить сотрудника», попадает в список организаций и не
 * находит там ничего похожего. Ровно так и было у партнёра.
 *
 * Страж открывает страницу назначения ВМЕСТЕ с её компонентами (кнопка обычно
 * живёт в компоненте, а не в самой странице) и требует, чтобы обещанная
 * подпись там нашлась.
 */
const ROLES: QuickTasksRole[] = ['admin', 'manager', 'leader', 'partner', 'organization'];
const APP = join(process.cwd(), 'src', 'app');

/** Файл страницы для адреса вида `/manager/import`. */
function pageFile(href: string): string {
  const path = href.split('?')[0] ?? href;
  return join(APP, path.replace(/^\//, ''), 'page.tsx');
}

/**
 * Исходник страницы вместе с её компонентами. Две ступени импортов: кнопка
 * часто лежит не в самой странице и даже не в её секции, а в диалоге, который
 * секция подключает (`страница → секция «Сотрудники» → диалог «Добавить
 * сотрудника»`).
 */
function componentFile(spec: string): string | null {
  const base = join(process.cwd(), 'src', spec.slice('@/'.length));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function screenSource(href: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  const visit = (file: string, depth: number) => {
    if (seen.has(file) || depth > 2) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    parts.push(src);
    for (const m of src.matchAll(/from '(@\/components\/[^']+)'/g)) {
      const next = componentFile(m[1] as string);
      if (next) visit(next, depth + 1);
    }
  };

  visit(pageFile(href), 0);
  return parts.join('\n');
}

/**
 * Плитки, которые обещают действие, но ведут на экран-перекрёсток. Допустимо
 * только там, где экрана с кнопкой в принципе не существует: действие живёт
 * внутри объекта, а какого именно — знает только человек. Такая плитка обязана
 * договорить недостающий шаг в подсказке.
 */
const CROSSROAD_TILES: Array<{ role: QuickTasksRole; href: string; why: string }> = [
  {
    role: 'partner',
    href: '/partner/portfolio',
    why:
      '`У-105` дословно: у партнёра плитка ведёт в «Портфель» с подсказкой ' +
      '«откройте организацию → Сотрудники». Кнопка живёт внутри карточки ' +
      'конкретного клиента, и выбрать клиента может только человек.',
  },
];

const CREATION_VERBS = ['Добавить', 'Создать', 'Подать', 'Завести', 'Загрузить', 'Разнести'];

describe('частые задачи ведут на существующий экран (У-105)', () => {
  it.each(ROLES)('%s: у каждой плитки есть страница назначения', (role) => {
    for (const task of quickTasksFor(role)) {
      expect(
        existsSync(pageFile(task.href)),
        `Плитка «${task.title}» роли ${role} ведёт на ${task.href}, а такой страницы нет`
      ).toBe(true);
    }
  });

  it.each(ROLES)('%s: обещанная кнопка есть на экране назначения', (role) => {
    for (const task of quickTasksFor(role)) {
      if (!task.action) continue;
      expect(
        screenSource(task.href).includes(task.action),
        `Плитка «${task.title}» роли ${role} обещает кнопку «${task.action}», ` +
          `но на ${task.href} её нет — это тупик, а не подсказка`
      ).toBe(true);
    }
  });

  it('плитка, обещающая действие, либо ведёт к кнопке, либо договаривает шаг', () => {
    for (const role of ROLES) {
      for (const task of quickTasksFor(role)) {
        const promisesAction = CREATION_VERBS.some((v) => task.title.startsWith(v));
        if (!promisesAction || task.action) continue;

        const exception = CROSSROAD_TILES.find((e) => e.role === role && e.href === task.href);
        expect(
          exception,
          `Плитка «${task.title}» роли ${role} обещает действие, но не говорит, ` +
            `где кнопка. Либо укажите её подпись в поле action, либо внесите ` +
            `плитку в CROSSROAD_TILES с причиной.`
        ).toBeDefined();
        // Перекрёсток обязан договорить шаг, а не бросить человека на списке.
        expect(task.hint).toContain('→');
      }
    }
  });

  it('исключения-перекрёстки объявлены с причиной, а не пустой строкой', () => {
    for (const e of CROSSROAD_TILES) {
      expect(e.why.trim().length).toBeGreaterThan(30);
    }
  });

  it('у каждой плитки есть подсказка в одну строку (§15)', () => {
    for (const role of ROLES) {
      for (const task of quickTasksFor(role)) {
        expect(task.hint.trim().length).toBeGreaterThan(0);
        expect(task.hint).not.toContain('\n');
      }
    }
  });
});
