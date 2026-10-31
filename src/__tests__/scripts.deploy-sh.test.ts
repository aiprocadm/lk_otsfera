import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `У-339` (ТЗ 28.10.2026, ДП §7): `scripts/deploy/deploy.sh <тег>` — один
 * скрипт выкладки для стейджинга и прода. Скрипт запускается по-настоящему;
 * `docker` и `curl` подменены двойниками, которые пишут вызовы в журнал и
 * отвечают так, как задал тест (FAKE_LOCAL / FAKE_UP / FAKE_CURL).
 */

const SCRIPT = join(process.cwd(), 'scripts', 'deploy', 'deploy.sh');

let dir: string;
let calls: string;

function stub(name: string, body: string) {
  const p = join(dir, 'bin', name);
  writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
  chmodSync(p, 0o755);
}

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: {
      PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
      HOME: dir,
      NODE_ENV: 'test',
      DEPLOY_DIR: join(dir, 'stack'),
      ...env,
    },
    encoding: 'utf8',
  });
  return {
    code: r.status,
    out: r.stdout,
    err: r.stderr,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
  };
}

const deployLog = () => {
  const p = join(dir, 'stack', 'deploy.log');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

const stackEnv = () => {
  const p = join(dir, 'stack', '.env');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-sh-'));
  calls = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', join(dir, 'bin'), join(dir, 'stack')]);
  writeFileSync(join(dir, 'stack', '.env.production'), 'APP_DOMAIN=lk.example.ru\n');
  stub(
    'docker',
    [
      'if [ "$1" = image ]; then exit "${FAKE_LOCAL:-1}"; fi',
      'if [ "$2" = up ]; then echo "IMAGE=$IMAGE_REPO:$IMAGE_TAG FILES=$COMPOSE_FILE" >> "' +
        '$(dirname "$0")/../env.log"; exit "${FAKE_UP:-0}"; fi',
      'exit 0',
    ].join('\n')
  );
  stub('curl', 'exit "${FAKE_CURL:-0}"');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('deploy.sh <тег> — выкладка одного образа (У-339)', () => {
  it('без тега — отказ с подсказкой, docker не вызывается', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('не указан тег образа');
    expect(r.calls).toBe('');
  });

  it.each(['../etc', 'v1 rm', '-rf', 'a;b'])('тег «%s» отвергается', (tag) => {
    const r = run([tag]);
    expect(r.code).toBe(2);
    expect(r.calls).toBe('');
  });

  it('без .env.production — отказ до docker', () => {
    rmSync(join(dir, 'stack', '.env.production'));
    const r = run(['v0.12.0']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('.env.production');
    expect(r.calls).toBe('');
  });

  it('образа нет локально → pull, up --wait, проверка здоровья, тег в deploy.log', () => {
    const r = run(['v0.12.0']);
    expect(r.code, r.err).toBe(0);
    const lines = r.calls.trim().split('\n');
    expect(lines[0]).toBe('docker image inspect lk-otsfera:v0.12.0');
    expect(lines[1]).toBe('docker compose pull migrate web worker');
    expect(lines[2]).toMatch(/^docker compose up -d --remove-orphans --wait --wait-timeout 600$/);
    expect(lines[3]).toMatch(/^curl .*http:\/\/127\.0\.0\.1:3000\/api\/health\/live$/);
    expect(readFileSync(join(dir, 'env.log'), 'utf8')).toContain(
      'IMAGE=lk-otsfera:v0.12.0 FILES=docker-compose.prod.yml'
    );
    expect(deployLog()).toMatch(/^\S+ v0\.12\.0\n$/);
    // служебные `docker compose ps/logs` после выкладки знают работающий тег
    expect(stackEnv()).toContain('IMAGE_TAG=v0.12.0\n');
    expect(stackEnv()).toContain('COMPOSE_FILE=docker-compose.prod.yml\n');
  });

  it('образ собран на этой машине → без pull', () => {
    const r = run(['v0.12.0'], { FAKE_LOCAL: '0' });
    expect(r.code, r.err).toBe(0);
    expect(r.calls).not.toContain('compose pull');
  });

  it('стейджинг: .deploy.env задаёт надстройку compose и реестр', () => {
    writeFileSync(
      join(dir, 'stack', '.deploy.env'),
      'COMPOSE_FILE=docker-compose.prod.yml:docker-compose.staging.yml\nIMAGE_REPO=registry.example/lk-otsfera\n'
    );
    const r = run(['staging-abc123']);
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(dir, 'env.log'), 'utf8')).toContain(
      'IMAGE=registry.example/lk-otsfera:staging-abc123 FILES=docker-compose.prod.yml:docker-compose.staging.yml'
    );
  });

  it('сервисы не поднялись → код ошибки, тег НЕ пишется, подсказан откат на прежний тег', () => {
    writeFileSync(join(dir, 'stack', 'deploy.log'), '2026-10-30T10:00:00+03:00 v0.11.0\n');
    writeFileSync(join(dir, 'stack', '.env'), 'IMAGE_TAG=v0.11.0\n');
    const r = run(['v0.12.0'], { FAKE_UP: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('НЕ удалась');
    expect(r.err).toContain(`${SCRIPT} v0.11.0`);
    expect(r.calls).not.toContain('curl');
    expect(deployLog()).toBe('2026-10-30T10:00:00+03:00 v0.11.0\n');
    expect(stackEnv(), 'при осечке .env хранит прежний работающий тег').toBe('IMAGE_TAG=v0.11.0\n');
  });

  it('приложение не отвечает на проверку здоровья → код ошибки, тег НЕ пишется', () => {
    const r = run(['v0.12.0'], { FAKE_CURL: '22' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('/api/health/live');
    expect(r.err).toContain('откатывать не на что');
    expect(deployLog()).toBe('');
  });

  it('образа нет ни локально, ни в реестре → код ошибки до up', () => {
    stub(
      'docker',
      'if [ "$1" = image ]; then exit 1; fi\nif [ "$2" = pull ]; then exit 1; fi\nexit 0'
    );
    const r = run(['v9.9.9']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('не найден');
    expect(r.calls).not.toContain('compose up');
  });
});
