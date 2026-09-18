import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

/**
 * `У-262` — снятый флаг не должен вернуться.
 *
 * Флаг возвращается не по злому умыслу, а по инерции: кто-то копирует соседний
 * блок кода вместе со строкой `flag: 'manager_cabinet'`, и раздел снова
 * оказывается за выключателем, которого больше нет в матрице и в
 * `.env.example`. Тогда выключатель есть в коде, но им никто не управляет — а
 * это хуже, чем и то и другое по отдельности.
 *
 * Страж держит три вещи: имени нет в списке флагов, переменной нет в
 * `.env.example`, и раздел «Снятые флаги» матрицы перечисляет ровно их.
 *
 * **Почему снимали именно эти.** Флаг снимается, только если выполнены все три
 * условия (`Р-Э9-1`): включён на стенде; не рычаг приёмки незакрытой работы;
 * его выключение не защищает от внешней неготовности и не является
 * комплаенс-паузой. Кабинет роли подходит под все три: выключенный кабинет —
 * не откат фичи, а «роль не может войти никуда».
 */
const REPO_ROOT = join(__dirname, '..', '..');

/** Снятые флаги. Список только растёт: вернуть флаг — отдельное решение. */
const REMOVED: string[] = [
  // Пачка A (`У-262`): кабинеты ролей.
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  // Пачка B: разделы прежних программ, отгружены и приняты.
  'enrollment_requests',
  'client_requests',
  'certificates_registry',
  // Пачка C: сделки, входящие и хаб «Настройки».
  'deals_pipeline',
  'intake_inbox',
  'settings_hub',
];

/** Имя env-переменной флага — та же схема, что у `featureFlagEnvVar`. */
function envVar(flag: string): string {
  return `FEATURE_${flag.toUpperCase()}`;
}

describe('снятые флаги не воскресают (У-262)', () => {
  it('ни одного снятого имени в списке флагов', () => {
    const alive = REMOVED.filter((f) => (FEATURE_FLAGS as readonly string[]).includes(f));
    expect(
      alive,
      'Эти флаги были сняты, а теперь снова в `FEATURE_FLAGS`:\n' +
        alive.map((f) => `  - ${f}`).join('\n') +
        '\n\nВозврат флага — отдельное решение: он должен появиться и в матрице,\n' +
        'и в `.env.example`, иначе им никто не управляет.'
    ).toEqual([]);
  });

  it('ни одной снятой переменной в .env.example', () => {
    // `.env` — не код продукта, читается как есть: снятие `//` здесь ни к чему.
    const env = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    const present = REMOVED.filter((f) => env.includes(envVar(f)));
    expect(
      present.map(envVar),
      'В `.env.example` вернулись переменные снятых флагов — их значение уже ни на что не влияет'
    ).toEqual([]);
  });

  it('матрица флагов объясняет, почему каждый снят', () => {
    // `.md` — разметка, читается как есть.
    const matrix = readFileSync(join(REPO_ROOT, 'docs/feature-flags-matrix.md'), 'utf8');
    expect(matrix, 'в матрице нет раздела «Снятые флаги»').toContain('## Снятые флаги');
    for (const flag of REMOVED) {
      expect(matrix, `в разделе «Снятые флаги» нет строки про ${flag}`).toContain(`\`${flag}\``);
    }
  });

  it('список снятых непуст (иначе проверка ничего не значит)', () => {
    expect(REMOVED.length).toBeGreaterThan(0);
  });
});
