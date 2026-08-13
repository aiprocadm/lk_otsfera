import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож командной палитры (`У-75`, этап 9).
 *
 * Две вещи ломаются молча и обнаруживаются только жалобой пользователя.
 *
 * 1. **Палитра пропала в одном из кабинетов.** Кабинетных обёрток пять
 *    (админ, менеджер, руководитель, партнёр+слушатель, заказчик); правку
 *    легко внести в четыре из них. Тест держит все пять.
 * 2. **Палитра завела свой список разделов.** Тогда она стала бы второй,
 *    более слабой картой доступа: показывала бы то, чего в меню нет. Поэтому
 *    разделы обязаны приходить из `navItemsFor` — того же реестра, что и
 *    сайдбар.
 */
const ROOT = join(__dirname, '..', '..');

const SHELLS = [
  { file: 'src/app/admin/layout.tsx', cabinet: 'админ' },
  { file: 'src/app/manager/layout.tsx', cabinet: 'менеджер' },
  { file: 'src/app/leader/layout.tsx', cabinet: 'руководитель' },
  { file: 'src/components/dashboard/app-shell.tsx', cabinet: 'партнёр и слушатель' },
  { file: 'src/components/organization/org-app-shell.tsx', cabinet: 'заказчик' },
];

/** Роли, у которых поиск по данным уже есть своей страницей. */
const SEARCH_ROLES = [
  { file: 'src/app/manager/layout.tsx', href: '/manager/search' },
  { file: 'src/app/leader/layout.tsx', href: '/leader/search' },
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('командная палитра смонтирована во всех кабинетах (У-75)', () => {
  it.each(SHELLS)('$cabinet: палитра на месте', ({ file }) => {
    const src = read(file);
    expect(src, `${file}: нет <CommandPalette>`).toContain('<CommandPalette');
    expect(src, `${file}: палитра не передана в каркас пропом palette`).toMatch(/palette=\{/);
  });

  it.each(SHELLS)('$cabinet: разделы берутся из реестра меню, а не из своего списка', ({ file }) => {
    const src = read(file);
    expect(src, `${file}: пропал источник разделов navItemsFor`).toContain('navItemsFor');
    // sections приходит переменной (items / производная от неё), а не литералом
    // с захардкоженными путями.
    const sections = src.match(/sections=\{([^}]+)\}/);
    expect(sections, `${file}: у палитры нет пропа sections`).not.toBeNull();
    expect(sections?.[1], `${file}: список разделов вписан руками`).not.toContain('/');
  });

  it('поиск по данным включён только там, где у роли уже есть своя страница поиска', () => {
    for (const { file, href } of SEARCH_ROLES) {
      const src = read(file);
      expect(src, `${file}: у роли есть поиск, но палитра его не даёт`).toContain('searchEnabled');
      expect(src, `${file}: не указана страница полных результатов`).toContain(href);
    }
    for (const { file } of SHELLS.filter((s) => !SEARCH_ROLES.some((r) => r.file === s.file))) {
      expect(read(file), `${file}: поиск по данным включён роли, у которой его нет`).not.toContain(
        'searchEnabled'
      );
    }
  });

  it('палитра зовёт общий сервис поиска, а не свой запрос в базу', () => {
    const action = read('src/server-actions/search.ts');
    expect(action).toContain('globalSearch');
    // Прямых запросов к таблицам быть не должно: скоупы живут в сервисе.
    expect(action).not.toMatch(/prisma\.\w+\.(findMany|findFirst)/);
    expect(action, 'нет проверки сессии').toContain('requireSession');
  });
});
