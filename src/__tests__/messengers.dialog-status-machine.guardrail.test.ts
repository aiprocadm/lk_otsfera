import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * Страж автомата статусов диалога (`У-207`, спека этапа 3 §3.2).
 *
 * Почему он нужен. В Prisma статус диалога — обычная строка: в `where`/`data`
 * опечатка (`waitng_staff`) не ловится ни типами, ни линтером. Запрос просто
 * ничего не найдёт — молча, и просроченный диалог никогда не попадёт к
 * руководителю. Поэтому значения `waiting_*` живут в одном модуле
 * `dialogStatus.ts`, а сервисы и воркер берут их оттуда.
 *
 * Исходники читаются через `readSource` (снимает комментарии): иначе
 * упоминание статуса в пояснении считалось бы нарушением, а закомментированный
 * литерал — наоборот, прошёл бы незамеченным.
 *
 * Проверено мутацией: замена `DIALOG_STATUS.waitingStaff` на литерал
 * `'waiting_staff'` в `sla-escalation.ts` роняет этот тест.
 */

/** Единственный файл, где значения статусов объявляются. */
const SOURCE_OF_TRUTH = 'src/lib/services/messengers/dialogStatus.ts';

/** Где статус попадает в запросы к базе — там опечатка и опасна. */
const GUARDED_DIRS = ['src/lib/services/messengers', 'src/worker/processors'];

/** Значения, которые нельзя писать строкой: они существуют только в автомате. */
const MACHINE_ONLY = ['waiting_staff', 'waiting_client'];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('автомат статусов диалога — единственный источник значений', () => {
  it('сервисы мессенджеров и процессоры воркера не пишут waiting_* строкой', () => {
    const offenders: string[] = [];
    for (const dir of GUARDED_DIRS) {
      for (const file of filesUnder(dir)) {
        if (file === SOURCE_OF_TRUTH) continue;
        const code = readSource(file);
        for (const value of MACHINE_ONLY) {
          if (code.includes(`'${value}'`) || code.includes(`"${value}"`)) {
            offenders.push(`${file}: ${value}`);
          }
        }
      }
    }
    expect(
      offenders,
      `Статус должен браться из DIALOG_STATUS (${SOURCE_OF_TRUTH}), а не писаться строкой:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('сам модуль автомата объявляет все четыре значения и их подписи', () => {
    const code = readSource(SOURCE_OF_TRUTH);
    for (const value of ['open', 'waiting_staff', 'waiting_client', 'closed']) {
      expect(code).toContain(`'${value}'`);
    }
    // Русские подписи обязательны: статус видит человек на экране (§15).
    expect(code).toContain('DIALOG_STATUS_LABELS');
  });
});
