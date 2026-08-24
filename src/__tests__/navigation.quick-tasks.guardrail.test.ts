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

/** Исходник страницы + её прямых компонентов (одна ступень импортов). */
function screenSource(href: string): string {
  const file = pageFile(href);
  const src = readFileSync(file, 'utf8');
  const parts = [src];
  for (const m of src.matchAll(/from '(@\/components\/[^']+)'/g)) {
    const base = join(process.cwd(), 'src', (m[1] as string).slice('@/'.length));
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')]) {
      if (existsSync(candidate)) {
        parts.push(readFileSync(candidate, 'utf8'));
        break;
      }
    }
  }
  return parts.join('\n');
}

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

  it('плитка не обещает того, чего на экране нет: партнёрский случай зафиксирован', () => {
    // Раньше здесь была плитка «Добавить сотрудника» → `/partner/portfolio`.
    // Кнопка живёт внутри карточки конкретного клиента, а не в списке, и
    // плитка вела в тупик. Проверяем, что она не вернулась.
    const partner = quickTasksFor('partner');
    const portfolio = partner.find((t) => t.href === '/partner/portfolio');
    expect(portfolio).toBeDefined();
    expect(portfolio?.title).not.toContain('Добавить');
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
