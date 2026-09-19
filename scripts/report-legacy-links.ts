/**
 * Dry-run перед удалением шлюза (`У-263`, этап 9).
 *
 *   npm run report:legacy-links
 *
 * **Зачем.** Шлюз — старый адрес, который уводит на новое место, чтобы
 * сохранённая ссылка не отдала «страница не найдена». Когда шлюз переваливает
 * за 90 дней, страж `navigation.legacy-gateways` просит его удалить. Но прежде
 * надо ответить на вопрос, которого страж не знает: **не осталось ли ссылок на
 * этот адрес там, откуда их уже не поправить?**
 *
 * **Что выяснилось при разборе (`У-263`).** Требование предполагало запрос к
 * базе «нет ли старых путей в ссылках уведомлений». Оказалось, что
 * уведомления **не хранят адрес**: у модели `Notification` есть тип и данные
 * события, а ссылка собирается при показе кодом (`lib/notifications/href.ts`).
 * То есть удаление шлюза ссылку в уведомлении сломать не может — она
 * пересоберётся текущим кодом.
 *
 * Поэтому отчёт смотрит два настоящих места:
 *
 *   1. **Данные события** (`Notification.meta`) — туда адрес мог попасть как
 *      строка, если его когда-то положили руками.
 *   2. **Код** — не ссылается ли что-нибудь на старый адрес напрямую, минуя
 *      шлюз. Такая ссылка после удаления шлюза приведёт в никуда, и это
 *      единственный случай, который мы можем и должны починить сами.
 *
 * Чего отчёт НЕ видит и видеть не может: ссылки в уже отправленных письмах и
 * закладки в браузерах. Ради них и существует срок в 90 дней.
 *
 * Коды выхода: 0 — чисто, шлюзы можно удалять по сроку; 1 — найдены ссылки,
 * которые сломаются.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { LEGACY_GATEWAYS } from '../src/lib/navigation/legacyGateways';
import { SETTINGS_SECTIONS } from '../src/lib/navigation/settings';

const REPO_ROOT = join(__dirname, '..');

/** Все старые адреса из обоих реестров. */
function legacyPaths(): string[] {
  const out = LEGACY_GATEWAYS.map((g) => g.from);
  for (const section of SETTINGS_SECTIONS) {
    for (const legacy of section.legacyHrefs) out.push(legacy.from);
  }
  return [...new Set(out)].sort();
}

/** Файлы кода, где ссылка на старый адрес была бы настоящей ссылкой. */
function codeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'e2e' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      codeFiles(full, out);
      continue;
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Текст файла без комментариев: упоминание адреса в пояснении — не ссылка.
 *
 * Без этого отчёт краснел бы на каждом комментарии вида «раньше жила по адресу
 * `/organization/students`», которых в проекте много и которые как раз
 * объясняют переезд.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * Ссылается ли файл на старый адрес.
 *
 * **Почему не просто `includes("'" + path + "'")`.** Ровно так было написано
 * сначала — и отчёт молчал про настоящие ссылки. В разметке ссылка пишется
 * атрибутом: `href="/organization/students"`, в **двойных** кавычках; в коде
 * встречается и шаблонная строка с подстановкой:
 * `` `/organization/students/${id}` ``. Сухой прогон приёмки (этап 10) нашёл
 * две живые ссылки, которых отчёт не видел.
 *
 * Адрес карточки записан в реестре шаблоном (`/manager/students/[id]`);
 * искать его буквально бесполезно, поэтому ищем часть до первой скобки — она
 * же покрывает и список, и карточку.
 */
function mentionsLegacy(src: string, legacyHref: string): boolean {
  const needle = legacyHref.split('[')[0]?.replace(/\/$/, '') ?? legacyHref;
  if (!needle) return false;
  const body = stripComments(src);
  // Адрес внутри строкового литерала любого из трёх видов. После адреса
  // допускаем «/», «?», «#» и закрывающую кавычку — чтобы `/organization/students`
  // не совпал с посторонним `/organization/students-import`.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`['"\`]${escaped}(?=['"\`/?#])`);
  return re.test(body);
}

/** Файлы самих шлюзов и реестров: упоминание адреса там — норма, а не ссылка. */
function isRegistryOrGateway(path: string, legacyHref: string): boolean {
  if (path.includes('navigation/legacyGateways.ts')) return true;
  if (path.includes('navigation/settings.ts')) return true;
  if (path.includes('next.config.mjs')) return true;
  // `featureFlags.ts` перечисляет маршруты, которые закрывает флаг. Это не
  // ссылка, по которой пойдёт человек, а правило доступа: если раздел выключен,
  // его шлюз обязан отвечать 404, а не уводить в хаб.
  if (path.includes('lib/featureFlags.ts')) return true;
  // Сама страница-шлюз называет свой адрес — это и есть её работа.
  const asFile = legacyHref.replace(/^\//, '').replace(/\?.*$/, '');
  return path.includes(join('app', asFile));
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const paths = legacyPaths();
    console.log(`Старых адресов под наблюдением: ${paths.length}\n`);

    // ─── 1. Данные событий ───────────────────────────────────────────────
    console.log('Ссылки в данных уведомлений:');
    let inData = 0;
    for (const path of paths) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "Notification" WHERE "meta"::text LIKE $1`,
        `%${path}%`
      );
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) {
        inData += n;
        console.log(`  ${path}: ${n} записей`);
      }
    }
    if (inData === 0) console.log('  не найдено.');

    // ─── 2. Код ──────────────────────────────────────────────────────────
    console.log('\nПрямые ссылки в коде (мимо шлюза):');
    const files = codeFiles(join(REPO_ROOT, 'src'));
    let inCode = 0;
    for (const path of paths) {
      const hits = files.filter(
        (f) => !isRegistryOrGateway(f, path) && mentionsLegacy(readFileSync(f, 'utf8'), path)
      );
      if (hits.length > 0) {
        inCode += hits.length;
        console.log(`  ${path}:`);
        for (const h of hits) console.log(`    ${h.replace(`${REPO_ROOT}/`, '')}`);
      }
    }
    if (inCode === 0) console.log('  не найдено.');

    if (inData + inCode === 0) {
      console.log('\nИтог: чисто — шлюзы можно удалять по сроку (90 дней).');
      return 0;
    }
    console.log(
      '\nИтог: удаление шлюза сломает найденное выше. Сначала переведите ссылки\n' +
        'на новые адреса, потом удаляйте.'
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('Отчёт не выполнен:', e);
    process.exit(2);
  });
