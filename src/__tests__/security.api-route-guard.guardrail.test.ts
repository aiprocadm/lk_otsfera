import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

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
    const mw = readFileSync(join(ROOT, 'src', 'middleware.ts'), 'utf8');
    expect(mw, 'matcher middleware изменился — перечитай правило').toMatch(
      /matcher:\s*\[\s*'\/\(\(\?!api\|/
    );
  });

  it('ни один обработчик не отвечает без проверки вызывающего', () => {
    const allowed = new Set(PUBLIC_BY_DESIGN.map((e) => e.route));
    const unguarded: string[] = [];

    for (const file of files) {
      const src = readFileSync(join(ROOT, file), 'utf8');
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
      const src = readFileSync(join(ROOT, e.route), 'utf8');
      expect(GUARD.test(src), `${e.route}: гард есть — убери роут из PUBLIC_BY_DESIGN`).toBe(false);
    }
  });
});
