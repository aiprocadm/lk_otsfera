import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_PREFIXES } from '@/lib/featureFlags';

/**
 * Сторож третьей точки гейтинга (§5 CLAUDE.md).
 *
 * «Три точки чтения флага: middleware → 404; nav → скрытие пункта; страница
 * или route-handler → собственная проверка. Не добавляй новый флаг без всех
 * трёх точек.»
 *
 * Третья точка держалась на внимательности и в двух местах отсутствовала:
 * кабинеты менеджера и заказчика полагались на один лишь список префиксов
 * middleware, хотя у кабинета руководителя такая проверка была с самого
 * начала. Разделы хаба «Настройки» закрыты иначе и правильно — через
 * `requireSettingsSection`, он берёт флаг раздела из реестра.
 *
 * Почему одного middleware мало: список префиксов — обычный массив, он уже
 * однажды разъезжался с реальностью в этом проекте (списки MIME-типов), а
 * `settings_hub` в него намеренно не входит. Страница обязана уметь закрыться
 * сама.
 */
const APP = join(__dirname, '..', 'app');

/** Читается ли флаг где-то в поддереве маршрута (layout, page, вложенные). */
function readsFlag(prefixDir: string, flag: string): boolean {
  if (!existsSync(prefixDir)) return false;
  const stack = [prefixDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8');
      if (src.includes(`'${flag}'`)) return true;
      // Разделы хаба «Настройки» закрываются флагом не сами: его берёт
      // `requireSettingsSection` из реестра settings.ts (`section.flag` →
      // notFound). Это тоже полноценная третья точка, просто общая на все
      // разделы — переписывать её на каждой странице значило бы плодить копии.
      if (src.includes('requireSettingsSection(')) return true;
    }
  }
  return false;
}

/**
 * Адреса, у которых третья точка живёт НЕ в их собственном поддереве — с
 * причиной у каждого. Ключ — именно адрес, а не флаг: исключение по флагу
 * заодно освободило бы от проверки и настоящие страницы.
 */
const ELSEWHERE = new Map<string, string>([
  ['/leader/roles', 'шлюз старого адреса: вызывает страницу хаба напрямую, её гард и срабатывает'],
  ['/admin/roles', 'шлюз старого адреса: вызывает страницу хаба напрямую, её гард и срабатывает'],
]);

describe('у каждого route-флага есть третья точка гейтинга (§5)', () => {
  it('страница или её поддерево проверяют флаг сами, а не только middleware', () => {
    const missing: string[] = [];

    for (const { prefix, flag } of FEATURE_PREFIXES) {
      const dir = join(APP, prefix.replace(/^\//, ''));
      if (readsFlag(dir, flag)) continue;
      if (ELSEWHERE.has(prefix)) continue;
      missing.push(`${prefix} → ${flag}`);
    }

    expect(missing, 'раздел закрывается только префиксом middleware').toEqual([]);
  });

  it('кабинетные флаги проверяются именно в layout — одной точкой на весь кабинет', () => {
    // Иначе проверку пришлось бы повторять на каждой из десятков страниц, и
    // однажды её бы забыли — что и произошло до этой правки.
    for (const [cabinet, flag] of [
      ['manager', 'manager_cabinet'],
      ['leader', 'leader_cabinet'],
      ['organization', 'organization_cabinet'],
    ] as const) {
      const layout = readFileSync(join(APP, cabinet, 'layout.tsx'), 'utf8');
      expect(layout, `${cabinet}: layout обязан проверять ${flag}`).toContain(`'${flag}'`);
      expect(layout, `${cabinet}: проверка флага должна вести к notFound`).toContain('notFound');
    }
  });

  it('список исключений не разрастается', () => {
    expect(ELSEWHERE.size).toBeLessThanOrEqual(3);
  });
});
