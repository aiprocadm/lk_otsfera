/**
 * Guardrail: `У-72` — хлебные крошки на ВСЕХ вложенных экранах.
 *
 * **Зачем.** Требование этапа 9 звучит «на всех вложенных экранах», и аудит
 * 13.08.2026 поставил ему `✅`, перечислив покрытые деталки. Сверка 19.08.2026
 * (§16) показала, что перечисление и было проблемой: **12 из 24** вложенных
 * экранов крошек не имели — admin/orders, admin/documents, manager/documents,
 * leader/orders, partner (документы, заявки, обращения, все три экрана
 * портфеля), organization (заявки, обращения). Человек попадал на такой экран
 * и терял ответ на вопрос «где я» (§15 CLAUDE.md).
 *
 * Список экранов растёт сам собой, поэтому проверка — не список, а правило:
 * **любая** страница с динамическим сегментом в пути обязана рендерить крошки.
 * Забыть их в новом экране physically нельзя — тест покраснеет.
 *
 * Проверен мутацией (§16): снятие `<Breadcrumbs>` с любой такой страницы
 * роняет тест.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APP = path.join(__dirname, '..', 'app');

/**
 * Экраны, которым крошки не положены, — с причиной. Пустой: сегодня таких нет.
 * Добавлять сюда можно только осознанно (например, полноэкранный мастер без
 * родителя), а не «чтобы тест позеленел».
 */
const EXEMPT: Array<{ page: string; why: string }> = [];

function nestedPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      nestedPages(full, acc);
    } else if (entry === 'page.tsx' && dir.includes('[')) {
      acc.push(full);
    }
  }
  return acc;
}

function rel(p: string): string {
  return path.relative(path.join(__dirname, '..'), p).split(path.sep).join('/');
}

/**
 * Шлюз — страница, которая ничего не рисует, а уводит на новый адрес (старые
 * ссылки и закладки продолжают работать). Крошек у неё быть не может: экрана
 * нет. Это правило, а не список исключений: страница, которая хоть что-то
 * рендерит, проверку проходит наравне со всеми.
 */
function isGateway(src: string): boolean {
  return /\bredirect\(/.test(src) && !/return\s*\(/.test(src);
}

/**
 * Страница + её компоненты на один уровень вглубь. Экран деталки может быть
 * общим на два кабинета (`У-110`: карточка документа менеджера и руководителя —
 * один компонент), и тогда крошки живут в нём, а не в `page.tsx`. Смотреть
 * только на страницу — значит объявить дефектом ровно то переиспользование,
 * которого требует правило зеркала.
 */
function chainOf(page: string): string[] {
  const src = readFileSync(page, 'utf8');
  const out = [src];
  for (const m of src.matchAll(/from '(@\/components\/[^']+)'/g)) {
    const base = path.join(__dirname, '..', (m[1] as string).slice('@/'.length));
    for (const cand of [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx')]) {
      if (existsSync(cand)) {
        out.push(readFileSync(cand, 'utf8'));
        break;
      }
    }
  }
  return out;
}

describe('У-72: крошки на всех вложенных экранах', () => {
  const pages = nestedPages(APP).map(rel).sort();

  it('вложенные экраны вообще найдены (иначе тест проверяет пустоту)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(20);
  });

  it('каждый вложенный экран рендерит хлебные крошки', () => {
    const exempt = new Set(EXEMPT.map((e) => e.page));
    const without = pages
      .filter((p) => !exempt.has(p))
      .filter((p) => {
        const chain = chainOf(path.join(__dirname, '..', p));
        if (isGateway(chain[0] as string)) return false;
        // Крошки рисует либо сама страница, либо её вьюха — но рисует кто-то.
        // Ищем именно ОТРИСОВКУ (`<Breadcrumbs`) или передачу вьюхе
        // (`breadcrumbs={`): по одному упоминанию слова тест зеленел бы от
        // осиротевшего импорта — проверено мутацией.
        return !chain.some((src) => /<Breadcrumbs\b|breadcrumbs=\{/.test(src));
      });

    expect(without).toEqual([]);
  });

  it('исключения объявлены с причиной, а не пустой строкой', () => {
    for (const e of EXEMPT) {
      expect(e.why.trim().length).toBeGreaterThan(10);
    }
  });
});
