import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * `У-120` — **каждая** страница кабинета заказчика рисует оболочку кабинета.
 *
 * **Почему только этот кабинет.** У менеджера, руководителя, администратора и
 * партнёра оболочку рисует `layout.tsx` — забыть её невозможно. У заказчика
 * `layout.tsx` намеренно пустой: активная организация берётся из `searchParams`,
 * а layout в App Router их не видит. Поэтому каждая страница зовёт
 * `OrgAppShell` сама — и может об этом забыть.
 *
 * **Что тогда происходит.** Ровно это нашёл сухой прогон приёмки (этап 10):
 * `/organization/messages` открывался без бокового меню, без шапки и без
 * кнопки «Выйти». Человек приходит туда с кнопки «Написать» на главной и
 * оказывается в тупике — уйти можно только кнопкой «назад» в браузере.
 * Ни один тест этого не ловил: страница отвечала 200, заголовок был на месте,
 * сервисы отдавали данные. Не было только всего остального.
 *
 * **Шлюзы — исключение, и это видно по коду.** Страница, которая только
 * уводит на новый адрес (`redirect`/`permanentRedirect`/`notFound`) и ничего
 * не рисует, оболочка не нужна: её никто не увидит.
 */
const ORG_PAGES_ROOT = join(process.cwd(), 'src', 'app', 'organization');

/** Все `page.tsx` кабинета заказчика. */
function orgPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      orgPages(full, out);
      continue;
    }
    if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** Страница только уводит на новый адрес и своей разметки не имеет. */
function isGateway(src: string): boolean {
  if (!/\b(redirect|permanentRedirect|notFound)\s*\(/.test(src)) return false;
  // Своя разметка — любой JSX-тег. У шлюза его нет вовсе.
  return !/<[A-Za-z]/.test(src);
}

function shortPath(full: string): string {
  return full.slice(full.indexOf(join('src', 'app')));
}

describe('каждая страница кабинета заказчика — в оболочке кабинета (У-120)', () => {
  const pages = orgPages(ORG_PAGES_ROOT);

  it('страницы вообще найдены (иначе проверка ничего не значит)', () => {
    expect(pages.length).toBeGreaterThan(8);
  });

  it('страница с разметкой обязана звать OrgAppShell', () => {
    const bare = pages
      .map((p) => ({ p, src: readSource(p) }))
      .filter(({ src }) => !isGateway(src))
      .filter(({ src }) => !/<OrgAppShell\b/.test(src))
      .map(({ p }) => `  ${shortPath(p)}`);

    expect(
      bare,
      'Эти страницы кабинета заказчика рисуются БЕЗ оболочки:\n' +
        bare.join('\n') +
        '\n\nЗначит, у человека на них нет ни бокового меню, ни шапки, ни кнопки\n' +
        '«Выйти» — он в тупике. Оберните разметку в <OrgAppShell …>, взяв props\n' +
        'из getOrgPageContext(searchParams), как это делают остальные страницы.\n' +
        'Если страница — шлюз и только уводит на новый адрес, у неё не должно\n' +
        'быть своей разметки вовсе.'
    ).toEqual([]);
  });

  it('шлюзы распознаются и оболочки не требуют', () => {
    // Без этой проверки предыдущая могла бы зеленеть просто потому, что
    // `isGateway` считает шлюзом всё подряд. Настоящих шлюзов в кабинете
    // заказчика больше нет — их удалили (`У-263`, прогон сопровождения №37),
    // поэтому признак проверяем на образцах.
    expect(isGateway(`export default function P() { redirect('/x'); }`)).toBe(true);
    expect(isGateway(`export default function P() { return <OrgAppShell />; }`)).toBe(false);
    const gateways = pages.filter((p) => isGateway(readSource(p))).map(shortPath);
    expect(gateways, 'шлюзы старых адресов удалены — новых быть не должно').toEqual([]);
  });
});
