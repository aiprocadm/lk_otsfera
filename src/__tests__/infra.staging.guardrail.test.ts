import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-340` (ТЗ 28.10.2026, ДП §5): стейджинг — тот же стек, закрытый паролем.
 * Открыты только вебхуки провайдеров и публичная форма заявки: их вызывают
 * снаружи без пароля. Пароль (хеш) живёт только на сервере, не в репозитории.
 */

const ROOT = process.cwd();
// Комментарии снимаются: закомментированная защита не защищает.
const strip = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
const caddy = strip(readFileSync(join(ROOT, 'Caddyfile.staging'), 'utf8'));
const override = strip(readFileSync(join(ROOT, 'docker-compose.staging.yml'), 'utf8'));
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n');

describe('Caddyfile.staging — всё за паролем, кроме вебхуков и формы (У-340)', () => {
  it('пароль на всём, кроме /api/integrations/* и /api/public/*', () => {
    const matcher = /@private\s+not\s+path\s+([^\n]+)/.exec(caddy)?.[1]?.trim().split(/\s+/);
    expect(matcher).toEqual(['/api/integrations/*', '/api/public/*']);
    expect(caddy).toMatch(/basic_auth\s+@private\s*\{/);
  });

  it('хеш пароля не в репозитории — подключается файлом с сервера', () => {
    expect(caddy).toMatch(/import\s+\/etc\/caddy\/staging-users/);
    expect(caddy, 'bcrypt-хеш в Caddyfile').not.toMatch(/\$2[aby]\$/);
    expect(gitignore).toContain('caddy-staging-users');
  });

  it('поисковикам запрещено индексировать стейджинг', () => {
    expect(caddy).toMatch(/header\s+X-Robots-Tag\s+"noindex, nofollow"/);
  });

  it('проксирует то же приложение', () => {
    expect(caddy).toMatch(/reverse_proxy\s+web:3000/);
  });
});

describe('docker-compose.staging.yml — надстройка меняет только Caddy (У-340)', () => {
  it('подменяет Caddyfile стейджинговым и монтирует файл пользователей', () => {
    expect(override).toContain('./Caddyfile.staging:/etc/caddy/Caddyfile:ro');
    expect(override).toContain('./caddy-staging-users:/etc/caddy/staging-users:ro');
  });

  it('других сервисов не трогает — стейджинг остаётся копией прода', () => {
    const services = [...override.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
    expect(services).toEqual(['caddy']);
  });

  it('секреты выкладки не попадают в git', () => {
    expect(gitignore).toEqual(expect.arrayContaining(['.deploy.env', 'deploy.log']));
  });
});
