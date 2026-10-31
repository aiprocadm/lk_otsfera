import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-344` (ТЗ 28.10.2026, ДП §7): заготовки перехода на ветки `staging → main`
 * лежат в `.github/staging-switch/` и НЕ включены до `Н-9`. Включённый раньше
 * времени джоб `source-branch` валил бы каждый нынешний PR в `main`, а новый
 * workflow требует решения владельца (CLAUDE.md §11).
 *
 * При переключении (инструкция — `.github/staging-switch/README.md`) первый
 * блок этого стража переворачивается в том же PR.
 *
 * `У-343`: ранбук выкладки — главный документ; команда первого администратора
 * из него работает в образе.
 */

const ROOT = process.cwd();
const SWITCH = join(ROOT, '.github', 'staging-switch');
// `#`-комментарии снимаются: закомментированная строка не считается настройкой.
const stripHash = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

describe('заготовки staging → main лежат выключенными (У-344)', () => {
  it('все четыре заготовки на месте', () => {
    for (const f of [
      'README.md',
      'CODEOWNERS.template',
      'ci-source-branch.job.yml',
      'deploy-staging.yml',
    ]) {
      expect(existsSync(join(SWITCH, f)), f).toBe(true);
    }
  });

  it('автодеплой стейджинга не включён: в workflows только ci.yml', () => {
    expect(readdirSync(join(ROOT, '.github', 'workflows'))).toEqual(['ci.yml']);
  });

  it('джоб source-branch не вставлен в ci.yml', () => {
    expect(stripHash(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'))).not.toMatch(
      /^ {2}source-branch:/m
    );
  });

  it('действующий CODEOWNERS — прежний, заготовка его не подменила', () => {
    expect(stripHash(readFileSync(join(ROOT, '.github/CODEOWNERS'), 'utf8')).trim()).toBe(
      '* @aiprocadm'
    );
  });
});

describe('содержимое заготовок (У-344)', () => {
  const job = readFileSync(join(SWITCH, 'ci-source-branch.job.yml'), 'utf8');

  /** Исполняет шаг проверки из заготовки так, как его исполнит раннер. */
  function sourceBranchAllows(headRef: string): boolean {
    const script = /run: \|\n([\s\S]+)$/.exec(job)?.[1];
    expect(script, 'в заготовке нет шага run').toBeTruthy();
    const body = script!.replace(/^ {8}/gm, '');
    return (
      spawnSync('bash', ['-c', body], { env: { HEAD_REF: headRef, NODE_ENV: 'test' } }).status === 0
    );
  }

  it.each(['staging', 'hotfix/oplata-410'])('source-branch пропускает PR из «%s»', (ref) => {
    expect(sourceBranchAllows(ref)).toBe(true);
  });

  it.each(['feat/12-kanban', 'claude/tr-stage3-pr3', 'staging-old', 'main'])(
    'source-branch отклоняет PR из «%s»',
    (ref) => {
      expect(sourceBranchAllows(ref)).toBe(false);
    }
  );

  it('source-branch срабатывает только на PR в main', () => {
    expect(job).toContain("if: github.event_name == 'pull_request' && github.base_ref == 'main'");
  });

  it('deploy-staging: только push в staging, тот же deploy.sh, клон на коммит образа', () => {
    const wf = stripHash(readFileSync(join(SWITCH, 'deploy-staging.yml'), 'utf8'));
    expect(wf).toMatch(/on:\s*\n\s+push:\s*\n\s+branches: \[staging\]/);
    expect(wf).toContain('/srv/lk/scripts/deploy/deploy.sh staging-${{ github.sha }}');
    expect(wf).toContain('checkout --detach ${{ github.sha }}');
    expect(wf).not.toMatch(/\bmain\b/);
  });

  it('CODEOWNERS-заготовка покрывает чувствительные пути ДП §7', () => {
    const owners = stripHash(readFileSync(join(SWITCH, 'CODEOWNERS.template'), 'utf8'));
    for (const path of [
      '/prisma/',
      '/src/lib/auth/',
      '/src/middleware.ts',
      '/src/app/api/integrations/',
      '/docker-compose*.yml',
      '/Dockerfile',
      '/Caddyfile*',
      '/.github/',
      '/CLAUDE.md',
      '/package.json',
      '/package-lock.json',
    ]) {
      expect(owners, path).toMatch(
        new RegExp(`^${path.replace(/[.*]/g, '\\$&')} @aiprocadm$`, 'm')
      );
    }
  });
});

describe('ранбук выкладки и первый запуск (У-343)', () => {
  const runbook = readFileSync(join(ROOT, 'docs/runbook-release.md'), 'utf8');

  it('фазы A–E, смоук-чек-лист и хотфикс прода', () => {
    for (const h of [
      '## Фаза A.',
      '## Фаза B.',
      '## Фаза C.',
      '## Фаза D.',
      '### Смоук-проверка',
      '## Фаза E.',
      '### Хотфикс прода',
    ]) {
      expect(runbook, h).toContain(h);
    }
    expect(runbook).toContain('./scripts/deploy/deploy.sh vX.Y.Z');
  });

  it('прежние ранбуки выкладки и README ссылаются на главный', () => {
    for (const f of ['RUNBOOK', 'runbook-prod-infra-rf', 'runbook-launch-deploy']) {
      expect(readFileSync(join(ROOT, 'docs', `${f}.md`), 'utf8'), f).toContain(
        '](runbook-release.md)'
      );
    }
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain('](docs/runbook-release.md)');
  });

  it('образ содержит скрипт первого администратора — команда из ранбука работает', () => {
    const dockerfile = stripHash(readFileSync(join(ROOT, 'Dockerfile'), 'utf8'));
    const runtime = dockerfile.slice(dockerfile.search(/^FROM \S+ AS runtime$/m));
    expect(runtime).toMatch(
      /^COPY --from=build \S* ?\/app\/scripts\/create-admin\.ts \.\/scripts\/create-admin\.ts$/m
    );
    expect(runbook).toContain('web npm run db:create-admin');
  });
});
