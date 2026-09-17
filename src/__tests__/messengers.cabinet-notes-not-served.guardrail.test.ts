import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { readSource } from './helpers/source';

vi.mock('@/lib/services/inbound/cabinetQuestion', () => ({ submitCabinetQuestion: vi.fn() }));

import { getCabinetDialog } from '@/lib/services/cabinetDialogs/get';

/**
 * СТРАЖ `У-234`/`У-209`: клиентские сервисы переписки не отдают внутренние
 * заметки сотрудников — ни сообщением, ни счётчиком, ни превью списка.
 *
 * Проверяется двумя способами сразу, и это принципиально: по исходнику —
 * что фильтр направления стоит ВНУТРИ каждого запроса сообщений (вынесенный в
 * переменную, он не виден и теряется при первой правке), и по поведению — что
 * сервис действительно передаёт его в базу.
 *
 * Мутация (проверено): убрать `direction` из любого из двух запросов
 * `messengerMessage` в `cabinetDialogs/get.ts` → тест краснеет; вернуть
 * превью заметки в список (`list.ts`) → краснеет проверка превью.
 */
const GET_SRC = readSource(join(process.cwd(), 'src/lib/services/cabinetDialogs/get.ts'));
const LIST_SRC = readSource(join(process.cwd(), 'src/lib/services/cabinetDialogs/list.ts'));

/** Куски исходника от `messengerMessage.<метод>(` до закрывающей скобки вызова. */
function messengerQueries(code: string): string[] {
  const out: string[] = [];
  const re = /messengerMessage\s*\.\s*\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    out.push(code.slice(m.index, i));
  }
  return out;
}

const ORG = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'o1', roleInOrg: 'member', isActive: true }],
} as unknown as SessionPayload;

describe('страж: заметки сотрудников не уходят в кабинет (У-234)', () => {
  it('каждый запрос сообщений в кабинетном сервисе фильтрует направление', () => {
    const queries = messengerQueries(GET_SRC);
    expect(queries.length, 'запросы сообщений пропали — страж охранял бы пустоту').toBeGreaterThan(
      1
    );
    for (const q of queries) {
      expect(q, `запрос без фильтра направления:\n${q}`).toContain(
        "direction: { in: ['in', 'out'] }"
      );
    }
  });

  it('фильтр доходит до базы, а не остаётся в комментарии', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const prisma = {
      messengerDialog: { findFirst: vi.fn(async () => ({ id: 'd1', channel: 'cabinet' })) },
      messengerMessage: { findMany, count },
    } as unknown as PrismaClient;

    const res = await getCabinetDialog(prisma, ORG, 'd1');
    expect(res.ok).toBe(true);
    const args = [findMany.mock.calls[0], count.mock.calls[0]] as unknown as Array<
      [{ where: { direction?: unknown } }]
    >;
    expect(args).toHaveLength(2);
    for (const [arg] of args) {
      expect(arg.where.direction).toEqual({ in: ['in', 'out'] });
    }
  });

  it('тип реплики в кабинете — только `in`/`out`: заметке в нём нет места', () => {
    expect(GET_SRC).toContain("direction: 'in' | 'out';");
    expect(GET_SRC).not.toContain("'note'");
  });

  it('превью списка не показывает заметку даже нейтральной пометкой', () => {
    expect(LIST_SRC).toContain("lastMessageDirection === 'note'");
    expect(LIST_SRC).toContain('isNote ? null : r.lastMessagePreview');
  });
});
