import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers/source';
import { PUBLIC_API_ROUTES } from '@/lib/api/publicRoutes';

/**
 * Каждый API-роут сам спрашивает, кто его зовёт.
 *
 * `middleware.ts` по роли закрывает только префиксы кабинетов, а его
 * `matcher` начинается с `(?!api|…)` — то есть `/api/**` он не смотрит
 * ВООБЩЕ. Роут отвечает всем, кто знает адрес, и единственная дверь — гард
 * внутри самого обработчика. На 07.09.2026 дверь стоит у всех 83
 * обработчиков, но проверял это только человек (найдено сопровождением
 * `С-4`, хотфикс №16) — так же, как было с серверными действиями до
 * хотфикса №15 (страж `server-actions.session-guard`).
 *
 * Дверью считается любой из способов — важно, что вызывающий назван:
 *  · гард роли или сессии (`requireManager`, `requireSession`, `getSession`…);
 *  · секрет или подпись внешней системы (`secretEquals`, `verifyMangoSign`) —
 *    так закрыты вебхуки Telegram/Max/WhatsApp/Mango, у них нет и не может
 *    быть сессии, но подделать вызов нельзя (нет секрета → 401, fail-closed);
 *  · одноразовый токен из письма (`verifyAndConsumeToken`) — сброс пароля.
 *
 * Остальное — поимённый список ниже, у каждого записана причина. Список
 * короткий намеренно: «публично» здесь всегда решение, а не умолчание.
 */
const ROOT = join(__dirname, '..', '..');

/** Роуты без гарда — с причиной. Пустая причина не принимается. */
const PUBLIC_BY_DESIGN: Array<{ route: string; why: string }> = [
  {
    route: 'src/app/api/auth/logout/route.ts',
    why: 'Выход гасит сессию. Требовать сессию, чтобы её погасить, — замкнутый круг; худшее, что даёт вызов без сессии, — очистка уже пустой куки.',
  },
  {
    route: 'src/app/api/auth/reset-password/request/route.ts',
    why: 'Просьба о сбросе приходит ДО всякой сессии. Защита здесь другая: ограничение частоты по IP и по адресу (429), а ответ одинаков для существующего и несуществующего адреса.',
  },
  {
    route: 'src/app/api/health/live/route.ts',
    why: 'Liveness-проба для мониторинга: отдаёт только {status:"ok"}, ни одного обращения к базе и ни одной подробности о системе.',
  },
  // Три роута ниже открыты по той же причине, что и сброс пароля: они
  // работают ДО всякой сессии. Записаны сюда хотфиксом №47 (`С-5`, прогон
  // №26): до него они проходили эту проверку СЛУЧАЙНО — в пояснении внутри
  // каждого упоминался `getSession()`, и страж, читавший исходник вместе с
  // комментариями, засчитывал упоминание за гард. То есть самые чувствительные
  // роуты продукта были исключены из проверки молча и без причины.
  {
    route: 'src/app/api/auth/login/route.ts',
    why: 'Вход происходит ДО сессии: требовать сессию, чтобы её получить, — замкнутый круг. Защита другая — общий лимитер по IP и по адресу (429) и одинаковый ответ на существующий и несуществующий адрес.',
  },
  {
    route: 'src/app/api/auth/2fa/verify/route.ts',
    why: 'Шаг подтверждения входа: сессии ещё нет, вместо неё pre-auth токен с purpose:"2fa" (роли в нём нет, getSession его отвергает) и одноразовый код. Защита — проверка токена, срок и предел числа попыток (429).',
  },
  {
    route: 'src/app/api/auth/2fa/resend/route.ts',
    why: 'Повторная отправка кода на том же до-сессионном шаге. Защита — тот же pre-auth токен плюс пауза 30 с между отправками и не более трёх повторов на десятиминутное окно challenge.',
  },
  {
    route: 'src/app/api/public/requests/route.ts',
    why: 'Заявка с формы на сайте (`У-211`): её присылает посторонний человек, сессии у него нет и быть не может. Проверка вызывающего ЕСТЬ, но живёт слоем ниже — в `submitWebsiteRequest` (токен формы через `secretEquals`, список доменов, предел частоты). Страж читает только файл роута и этого не видит; роут остаётся тонким намеренно (§3).',
  },
];

const HANDLER = /^export async function (GET|POST|PUT|PATCH|DELETE)/gm;
const GUARD =
  /\brequire[A-Z]\w*\(|\bgetSession\(|\bsecretEquals\(|\bverifyMangoSign\(|\bverifyAndConsumeToken\(/;

function routeFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src/app/api/**/route.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

const rel = (f: string) => f.split(sep).join('/');

describe('api-routes: каждый обработчик спрашивает права сам', () => {
  const files = routeFiles();

  it('роуты находятся — обход не сломан', () => {
    // Страж, которому нечего проверять, зелёный не потому, что всё хорошо.
    expect(files.length).toBeGreaterThan(50);
  });

  it('middleware по-прежнему не смотрит на /api — иначе правило можно смягчить', () => {
    // Если matcher когда-нибудь включит api, часть смысла стража отпадёт, и
    // об этом надо узнать здесь, а не из инцидента.
    const mw = readSource(join(ROOT, 'src', 'middleware.ts'));
    expect(mw, 'matcher middleware изменился — перечитай правило').toMatch(
      /matcher:\s*\[\s*'\/\(\(\?!api\|/
    );
  });

  it('исключение этого стража объявлено и в общем реестре публичных адресов', () => {
    // Списков «что открыто наружу» в проекте два, и вопросы у них разные:
    // здесь — «обработчик вообще спрашивает вызывающего?», в
    // `PUBLIC_API_ROUTES` — «адрес работает без сессии?». Пересекаться они
    // обязаны в одну сторону: всё, что освобождено ЗДЕСЬ, обязано быть заявлено
    // ТАМ. Без этой проверки списки разъезжаются молча — так и случилось:
    // `api/public/requests` попал в новый реестр и не попал в этот.
    const declared = new Set(PUBLIC_API_ROUTES.map((r) => `src/app${r.path}/route.ts`));
    const missing = PUBLIC_BY_DESIGN.map((e) => e.route).filter((r) => !declared.has(r));
    expect(
      missing,
      `Эти адреса освобождены здесь, но не заявлены в PUBLIC_API_ROUTES:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('ни один обработчик не отвечает без проверки вызывающего', () => {
    const allowed = new Set(PUBLIC_BY_DESIGN.map((e) => e.route));
    const unguarded: string[] = [];

    for (const file of files) {
      const src = readSource(join(ROOT, file));
      const heads = [...src.matchAll(HANDLER)];
      for (let i = 0; i < heads.length; i += 1) {
        const start = heads[i]?.index ?? 0;
        const end = heads[i + 1]?.index ?? src.length;
        const body = src.slice(start, end);
        // Гард ставят и в общем хелпере файла выше обработчика — смотрим и туда.
        const guarded = GUARD.test(body) || GUARD.test(src.slice(0, start));
        if (!guarded && !allowed.has(rel(file))) {
          unguarded.push(`${rel(file)}::${heads[i]?.[1]}`);
        }
      }
    }

    expect(
      unguarded,
      'API-роут отвечает без проверки вызывающего. `middleware.ts` на `/api/**` ' +
        'не смотрит (его matcher исключает api), поэтому роут доступен всем, кто ' +
        'знает адрес. Добавь гард (`requireManager`/`requireSession`), проверку ' +
        'секрета внешней системы или впиши роут в PUBLIC_BY_DESIGN с причиной:\n' +
        unguarded.join('\n')
    ).toEqual([]);
  });

  it('у каждого публичного роута записана причина, и сам роут существует', () => {
    const files = new Set(routeFiles().map(rel));
    for (const e of PUBLIC_BY_DESIGN) {
      expect(files.has(e.route), `${e.route}: роута нет — список исключений устарел`).toBe(true);
      expect(e.why.length, `${e.route}: причина не записана`).toBeGreaterThan(40);
    }
  });

  it('исключение не прячет роут, который на самом деле под гардом', () => {
    // Иначе список тихо разрастётся: проще вписать роут сюда, чем поставить
    // дверь. Если гард есть — роуту здесь не место.
    for (const e of PUBLIC_BY_DESIGN) {
      const src = readSource(join(ROOT, e.route));
      expect(GUARD.test(src), `${e.route}: гард есть — убери роут из PUBLIC_BY_DESIGN`).toBe(false);
    }
  });
});
