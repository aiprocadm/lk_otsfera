/**
 * Пиксельная сверка «код против кода на одних данных» — процедура `С-10`
 * (docs/tz/MAINTENANCE.md, прогон сопровождения №36).
 *
 * Почему не сравнивать с закоммиченными эталонами напрямую. Сид проставляет
 * даты «от сегодня», поэтому эталон, снятый в другой день, расходится с
 * сегодняшним снимком без единой правки кода: даты в таблицах, счётчики,
 * длина строк. Чтобы это не краснело, допуск держали в 2 % точек снимка — и
 * он пропускал опечатку в заголовке страницы (мутация прогона №36:
 * «Главная» → «Главня» на главной партнёра, 2 из 2 зелёные).
 *
 * Здесь обе стороны снимаются в ОДИН день на ДВУХ одинаковых копиях одной
 * засеянной базы: сначала код `--base` (эталоны пишутся во временную папку,
 * закоммиченные не трогаются), потом текущая рабочая копия сверяется с ними.
 * Данные совпадают до байта, поэтому расхождение означает правку кода, а
 * допуск в playwright.config.ts можно держать почти нулевым.
 *
 *   LD_LIBRARY_PATH=… npx tsx scripts/visual-diff.ts --base <git-ref> [--port 3100] [--keep]
 *
 * Обе стороны работают на ТЕКУЩЕЙ схеме и ТЕКУЩЕМ сиде: сравнивается
 * отрисовка, а не данные. Рычаги приёмки включаются переменными КОМАНДЫ:
 * общий `.env` не трогаем — он же у модульных тестов (прогон №29).
 * Базы-копии создаются только на localhost и удаляются в конце (`--keep`
 * оставляет их и временную папку для разбора).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = process.cwd();

/** Рычаги приёмки из процедуры `С-10`: эталоны держат состояние принятого продукта. */
const ACCEPTANCE_FLAGS = [
  'contacts',
  'bitrix_migration',
  'comm_center',
  'automation',
  'notification_center',
  'cabinet_questions',
  'chat',
  'leader_analytics',
  'internal_tasks',
  'inbound_messaging',
  'telephony_mango',
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
];

/** Поведенческие наборы (`mobile-shell`, `screen-rules`, `focus-trap`) — это `С-3`, а не пиксели. */
const BEHAVIOUR_SPEC = /(mobile-shell|screen-rules|focus-trap)\.spec\.ts$/;

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fromDotenv(key: string): string | undefined {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] === key && m[2] !== undefined) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/** Тот же сервер, другая база: имя базы — последний сегмент пути до `?`. */
function withDatabase(url: string, db: string): string {
  const q = url.indexOf('?');
  const head = q < 0 ? url : url.slice(0, q);
  const tail = q < 0 ? '' : url.slice(q);
  return `${head.slice(0, head.lastIndexOf('/'))}/${db}${tail}`;
}

async function sql(url: string, statement: string): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    await client.$executeRawUnsafe(statement);
  } finally {
    await client.$disconnect();
  }
}

async function dropDatabase(adminUrl: string, db: string): Promise<void> {
  await sql(
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()`
  );
  await sql(adminUrl, `DROP DATABASE IF EXISTS "${db}"`);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env, cwd });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function mustRun(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = ROOT) {
  const code = await run(cmd, args, env, cwd);
  if (code !== 0) throw new Error(`\`${cmd} ${args.join(' ')}\` завершился с кодом ${code}`);
}

async function responds(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/login`, { redirect: 'manual' });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function startServer(
  cwd: string,
  port: number,
  env: NodeJS.ProcessEnv,
  logFile: string
): Promise<ChildProcess> {
  if (await responds(port)) throw new Error(`порт ${port} уже занят — остановите тот сервер`);
  const out = openSync(logFile, 'a');
  // Своя группа процессов: `next dev` порождает дочерние, гасить надо всех.
  const child = spawn('npx', ['next', 'dev', '-p', String(port)], {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  for (let i = 0; i < 150; i++) {
    if (await responds(port)) return child;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  stopServer(child);
  throw new Error(`dev-сервер на порту ${port} не поднялся — журнал: ${logFile}`);
}

function stopServer(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Группа уже завершилась сама — гасить нечего.
  }
}

async function main(): Promise<number> {
  const base = option('base');
  if (!base) {
    console.error('[visual-diff] нужен --base <git-ref>: с отрисовкой какого кода сравнивать');
    return 2;
  }
  const port = Number(option('port') ?? 3100);
  const keep = process.argv.includes('--keep');

  const dbUrl = fromDotenv('DATABASE_URL');
  if (!dbUrl) throw new Error('DATABASE_URL не задан ни в окружении, ни в .env');
  const parsed = new URL(dbUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(`база на «${parsed.hostname}», а скрипт создаёт и удаляет базы только на localhost`);
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  const adminUrl = withDatabase(dbUrl, 'postgres');
  const tpl = `${dbName}_vis_tpl`;
  const baseDb = `${dbName}_vis_base`;
  const headDb = `${dbName}_vis_head`;

  const baseSha = spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    encoding: 'utf8',
  }).stdout.trim();
  if (!baseSha) throw new Error(`не нашёл коммит «${base}»`);

  const work = mkdtempSync(path.join(tmpdir(), 'visual-diff-'));
  const snapshotDir = path.join(work, 'snapshots');
  const baseTree = path.join(work, 'base');
  const specs = readdirSync(path.join(ROOT, 'src/e2e/snapshots'))
    .filter((f) => f.endsWith('.spec.ts') && !BEHAVIOUR_SPEC.test(f))
    .sort()
    .map((f) => `src/e2e/snapshots/${f}`);

  const flags = Object.fromEntries(ACCEPTANCE_FLAGS.map((f) => [`FEATURE_${f.toUpperCase()}`, '1']));
  const appEnv = (db: string): NodeJS.ProcessEnv => ({
    ...process.env,
    ...flags,
    DATABASE_URL: withDatabase(dbUrl, db),
    DIRECT_URL: withDatabase(dbUrl, db),
    // Без реквизитов «Звонков» приложение не стартует (`R0.2`); настоящие не нужны.
    MANGO_API_KEY: process.env.MANGO_API_KEY ?? 'visual-diff-fake-key',
    MANGO_API_SALT: process.env.MANGO_API_SALT ?? 'visual-diff-fake-salt',
    FAKE_BITRIX: '1',
  });
  const pwEnv = (db: string): NodeJS.ProcessEnv => ({
    ...appEnv(db),
    PLAYWRIGHT_BASE_URL: `http://localhost:${port}`,
    VISUAL_SNAPSHOT_DIR: snapshotDir,
  });

  console.log(`[visual-diff] база сравнения ${baseSha.slice(0, 8)}, временная папка ${work}`);
  let server: ChildProcess | undefined;
  let worktreeAdded = false;
  try {
    // 1. Одна засеянная база-образец и две её точные копии.
    await dropDatabase(adminUrl, tpl);
    await sql(
      adminUrl,
      `CREATE DATABASE "${tpl}" TEMPLATE template0 ENCODING 'UTF8' ` +
        `LOCALE_PROVIDER icu ICU_LOCALE 'und' LC_COLLATE 'C' LC_CTYPE 'C'`
    );
    await mustRun('npx', ['prisma', 'migrate', 'deploy'], appEnv(tpl));
    await mustRun('npm', ['run', 'prisma:seed'], appEnv(tpl));
    for (const db of [baseDb, headDb]) {
      await dropDatabase(adminUrl, db);
      await sql(adminUrl, `CREATE DATABASE "${db}" TEMPLATE "${tpl}"`);
    }

    // 2. Код --base: отдельная рабочая копия на тех же node_modules и .env.
    await mustRun('git', ['worktree', 'add', '--detach', baseTree, baseSha], process.env);
    worktreeAdded = true;
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(baseTree, 'node_modules'), 'dir');
    if (existsSync(path.join(ROOT, '.env'))) {
      copyFileSync(path.join(ROOT, '.env'), path.join(baseTree, '.env'));
    }
    server = await startServer(baseTree, port, appEnv(baseDb), path.join(work, 'base-dev.log'));
    const baseCode = await run(
      'npx',
      ['playwright', 'test', ...specs, '--update-snapshots', '--reporter=list'],
      pwEnv(baseDb)
    );
    stopServer(server);
    server = undefined;
    if (baseCode !== 0) {
      console.warn(
        `[visual-diff] у кода ${baseSha.slice(0, 8)} часть наборов упала (код ${baseCode}): ` +
          'их эталонов нет, в сверке они будут красными'
      );
    }

    // 3. Текущая рабочая копия против снятых эталонов, на своей копии той же базы.
    server = await startServer(ROOT, port, appEnv(headDb), path.join(work, 'head-dev.log'));
    const headCode = await run(
      'npx',
      ['playwright', 'test', ...specs, '--reporter=list'],
      pwEnv(headDb)
    );
    console.log(
      headCode === 0
        ? `[visual-diff] расхождений с ${baseSha.slice(0, 8)} нет (${specs.length} наборов)`
        : '[visual-diff] есть расхождения — картинки в playwright-report/test-results/*-diff.png'
    );
    return headCode;
  } finally {
    if (server) stopServer(server);
    if (worktreeAdded) spawnSync('git', ['worktree', 'remove', '--force', baseTree]);
    if (!keep) {
      for (const db of [baseDb, headDb, tpl]) {
        await dropDatabase(adminUrl, db).catch((e: unknown) =>
          console.warn(`[visual-diff] базу ${db} удалить не удалось:`, e instanceof Error ? e.message : e)
        );
      }
      rmSync(work, { recursive: true, force: true });
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('[visual-diff] ошибка:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
