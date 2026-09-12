import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from './helpers/source';

/**
 * Связанные записи идут одной транзакцией.
 *
 * Две записи подряд без транзакции — это состояние «наполовину». Сбой между
 * ними (обрыв соединения, перезапуск процесса, таймаут) оставляет систему в
 * положении, которого по бизнес-правилам не бывает. Сопровождение `С-8`
 * (07.09.2026, хотфикс №19) нашло два таких места:
 *
 *  · смена статуса заказа — `Order.statusId` менялся отдельно от записи в
 *    `OrderStatusChange`: заказ мог оказаться в новом статусе без строки в
 *    истории, а история смен — это разбор спорной ситуации, не украшение;
 *  · снятие участника партнёра — `PartnerUser.isActive = false` шло отдельно
 *    от `User.sessionVersion++`, хотя партнёрские клеймы живут в токене:
 *    сбой между ними оставлял снятого участника работать до истечения JWT.
 *
 * Страж закрепляет ровно эти два инварианта. Он намеренно не пытается
 * проверить «все многошаговые записи в проекте»: остальные найденные места —
 * фоновые задачи и импорт, где частичная запись переигрывается повторным
 * заходом, и общее правило дало бы ложные срабатывания вместо пользы.
 */
const SRC = join(__dirname, '..');
const read = (rel: string) => readSource(join(SRC, rel));

/** Тело транзакции: от `$transaction(async (tx) => {` до парной скобки. */
function transactionBodies(src: string): string[] {
  const out: string[] = [];
  const re = /\$transaction\(async \(tx\) => \{/g;
  for (const m of src.matchAll(re)) {
    let depth = 0;
    let i = (m.index ?? 0) + m[0].length - 1;
    const start = i;
    while (i < src.length) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

describe('write-atomicity: связанные записи идут одной транзакцией', () => {
  it('смена статуса заказа пишет историю в той же транзакции', () => {
    const src = read('lib/services/orderStatuses/transitions.ts');
    const bodies = transactionBodies(src);
    // Ручной переход и автоматический якорь — две отдельные транзакции.
    expect(
      bodies.length,
      'ожидались две транзакции: ручной переход и якорь'
    ).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body, 'в транзакции нет смены статуса').toMatch(/tx\.order\.update\(/);
      expect(body, 'в транзакции нет записи истории').toMatch(/tx\.orderStatusChange\.create\(/);
    }
    // Вне транзакции обеих записей быть не должно.
    const outside = bodies.reduce((acc, b) => acc.replace(b, ''), src);
    expect(outside, 'статус меняется мимо транзакции').not.toMatch(/prisma\.order\.update\(/);
    expect(outside, 'история пишется мимо транзакции').not.toMatch(
      /prisma\.orderStatusChange\.create\(/
    );
  });

  it('снятие участника партнёра гасит сессии в той же транзакции', () => {
    const src = read('lib/services/partner/team.ts');
    const withBoth = transactionBodies(src).filter(
      (b) => /tx\.partnerUser\.update\(/.test(b) && /tx\.user\.update\(/.test(b)
    );
    expect(
      withBoth.length,
      'нет транзакции, где снятие участника идёт вместе с гашением сессий'
    ).toBeGreaterThanOrEqual(1);
    expect(withBoth[0], 'сессии гасятся не инкрементом sessionVersion').toMatch(
      /sessionVersion:\s*\{\s*increment:\s*1\s*\}/
    );
  });

  it('уведомления и аудит остаются снаружи транзакции', () => {
    // Внешние вызовы внутри транзакции держали бы её открытой на время сети —
    // это отдельная беда, и страж следит, чтобы починка не создала её.
    const src = read('lib/services/orderStatuses/transitions.ts');
    for (const body of transactionBodies(src)) {
      expect(body, 'рассылка попала внутрь транзакции').not.toMatch(/notify\w*\(/);
      expect(body, 'запись аудита попала внутрь транзакции').not.toMatch(/recordAudit\(/);
    }
  });
});
