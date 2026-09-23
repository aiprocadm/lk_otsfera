/**
 * Где в базе остались ссылки на удалённые адреса (`У-263`).
 *
 *   npm run report:legacy-links
 *
 * **Что изменилось.** Раньше это был dry-run перед удалением шлюза: шлюз —
 * старый адрес, который уводил на новое место. 23.09.2026 заказчик решил не
 * ждать 90 дней, и шлюзы удалены (прогон сопровождения №37). Старый адрес
 * теперь отвечает 404 «раздел переехал». Список удалённых адресов —
 * `src/lib/navigation/removedPaths.ts`.
 *
 * **Что проверяет теперь.** Код сторожит тест `navigation.no-gateway-links` —
 * здесь его не повторяем. Остаются данные, которые тест не видит, потому что
 * они живут в базе стенда и прода:
 *
 *   1. `Notification.meta` — ссылка уведомления (`meta.url`). В ленте она
 *      не сломается: `lib/notifications/href.ts` не ведёт по удалённому адресу
 *      и строит ссылку по таблице маршрутов. Отчёт показывает, сколько таких
 *      строк, — чтобы было видно, на что опирается это правило.
 *   2. `NotificationTemplate.subject` / `body` — текст писем, который правят
 *      из интерфейса. Адрес, вписанный туда руками, уйдёт в каждое новое
 *      письмо и приведёт в 404 — такие шаблоны нужно поправить.
 *   3. `PartnerMaterial.externalUrl` — ссылка материала партнёра, её тоже
 *      вписывают руками.
 *
 * Чего отчёт не видит и видеть не может: ссылки в уже отправленных письмах и
 * закладки в браузерах. Для них и написана страница 404 «раздел переехал».
 *
 * Коды выхода: 0 — в шаблонах и материалах чисто (строки уведомлений только
 * пересчитываются); 1 — есть шаблон или материал, который ведёт в 404.
 */
import { PrismaClient } from '@prisma/client';
import { REMOVED_PATHS } from '../src/lib/navigation/removedPaths';

/**
 * Регулярное выражение Postgres (`~`) с границей сегмента: `/admin/sync` не
 * должен совпасть с `/admin/sync-log`, если такой раздел когда-нибудь
 * появится. Хвост — конец строки, `/`, `?`, `#`, кавычка или пробел.
 */
function pattern(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${escaped}($|[/?#"'\\s])`;
}

async function count(prisma: PrismaClient, sql: string, path: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql, pattern(path));
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    console.log(`Удалённых адресов в списке: ${REMOVED_PATHS.length}\n`);
    let notifications = 0;
    let broken = 0;
    for (const { path, movedTo } of REMOVED_PATHS) {
      const inMeta = await count(
        prisma,
        `SELECT count(*)::bigint AS n FROM "Notification" WHERE "meta"::text ~ $1`,
        path
      );
      const inTemplates = await count(
        prisma,
        `SELECT count(*)::bigint AS n FROM "NotificationTemplate" WHERE "subject" ~ $1 OR "body" ~ $1`,
        path
      );
      const inMaterials = await count(
        prisma,
        `SELECT count(*)::bigint AS n FROM "PartnerMaterial" WHERE "externalUrl" ~ $1`,
        path
      );
      if (inMeta + inTemplates + inMaterials === 0) continue;
      notifications += inMeta;
      broken += inTemplates + inMaterials;
      console.log(`${path} (теперь: ${movedTo})`);
      if (inMeta > 0) console.log(`  уведомления: ${inMeta} — ссылка пересчитается по таблице`);
      if (inTemplates > 0) console.log(`  шаблоны писем: ${inTemplates} — поправить адрес`);
      if (inMaterials > 0) console.log(`  материалы партнёров: ${inMaterials} — поправить адрес`);
    }
    if (notifications + broken === 0) {
      console.log('Итог: чисто — ни одной ссылки на удалённые адреса в базе.');
      return 0;
    }
    if (broken === 0) {
      console.log('\nИтог: исправлять нечего — старые адреса только в уведомлениях.');
      return 0;
    }
    console.log(
      '\nИтог: шаблоны писем или материалы ведут в 404. Замените адрес на новый\n' +
        '(он указан рядом) в «Настройки → Тексты писем» или в материалах партнёров.'
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
