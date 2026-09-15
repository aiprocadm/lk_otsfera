import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * Страж «внутренняя заметка не утекает клиенту» (`У-209`, `У-217`).
 *
 * У заметки ТРИ пути наружу, и закрыть надо все:
 *
 * 1. **Транспорт** — отправка в мессенджер или письмом. Заметка пишется прямо
 *    в базу и в транспорт не попадает вовсе.
 * 2. **Клиентские выборки** — то, что кабинет заказчика и партнёра читают из
 *    переписки (`У-212`, `У-234`). Там обязателен фильтр по направлению.
 * 3. **Превью диалога** — поле `lastMessagePreview` лежит на самом диалоге и
 *    не фильтруется по направлению НИГДЕ. Список диалогов в кабинете клиента
 *    покажет его целиком, поэтому текст заметки туда не пишется вовсе —
 *    только нейтральная пометка.
 *
 * Один запрет без другого бесполезен: закрой транспорт, но отдай заметку в
 * кабинет — и клиент прочитает её там же. Третью дверь нашли не сразу: две
 * первые были закрыты, а первые двести символов обсуждения всё равно уезжали
 * в превью.
 *
 * Второй тест поэтому охраняет БУДУЩЕЕ: пока клиентских выборок сообщений
 * диалога нет, он проверяет, что их и не появилось мимо фильтра.
 *
 * Проверено мутацией: вызов `sendToMessenger` в `note.ts` роняет первый тест;
 * выборка `messengerMessage.findMany` в клиентском роуте без `direction` —
 * второй.
 */

const NOTE_SERVICE = 'src/lib/services/messengers/note.ts';

/**
 * Куски исходника, относящиеся к запросам по сообщениям диалога: от
 * `prisma.messengerMessage.<метод>(` до закрывающей скобки вызова. Скобки
 * считаются, поэтому вложенные объекты и массивы не сбивают границу.
 */
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

/** Где живут клиентские (не-ЦО) пути чтения переписки. */
const CLIENT_AREAS = [
  'src/app/api/organization',
  'src/app/api/partner',
  'src/app/organization',
  'src/app/partner',
  'src/lib/services/organization',
  'src/lib/services/partner',
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Каталога может не быть — это не нарушение.
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('внутренняя заметка не уходит клиенту', () => {
  it('заметка не зовёт транспорт: у неё нет пути в канал', () => {
    const code = readSource(NOTE_SERVICE);
    for (const forbidden of ['sendToMessenger', 'sendAttachmentToMessenger', 'sendEmailReply']) {
      expect(
        code,
        `${forbidden} в заметке означал бы, что обсуждение коллег уходит клиенту`
      ).not.toContain(forbidden);
    }
  });

  it('клиентские выборки сообщений диалога обязаны фильтровать направление', () => {
    const offenders: string[] = [];
    for (const area of CLIENT_AREAS) {
      for (const file of filesUnder(area)) {
        const code = readSource(file);
        if (!code.includes('messengerMessage')) continue;
        // Фильтр ищем ВНУТРИ самого запроса, а не по файлу целиком.
        //
        // Почему так: `direction` в проекте значит ещё и УЧЕБНОЕ НАПРАВЛЕНИЕ
        // (`OrderItem.direction`, `directionName`), и это слово уже стоит в
        // двадцати файлах клиентского контура в совершенно другом смысле.
        // Пока страж смотрел на весь файл, утечка, дописанная в любой из них,
        // проходила молча — причём слепыми были ровно те файлы (заказы,
        // сводка), куда переписка и придёт. Найдено мутацией при закрытии
        // этапа (`У-217`): та же выборка без фильтра в `dashboard.ts` страж не
        // замечал, а в соседнем `team.ts` — ловил.
        for (const query of messengerQueries(code)) {
          if (!query.includes('direction')) offenders.push(file);
        }
      }
    }
    expect(
      offenders,
      `Клиент не должен видеть заметки (У-209). Добавьте фильтр direction:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('сервис заметки помечает сообщение именно как заметку', () => {
    const code = readSource(NOTE_SERVICE);
    expect(code).toContain("direction: 'note'");
  });

  it('текст заметки не попадает в превью диалога', () => {
    const code = readSource(NOTE_SERVICE);
    // Превью видно в списке диалогов, в том числе клиенту (`У-212`): там
    // должна стоять пометка-константа, а не обрезанный текст обсуждения.
    expect(code).toContain('lastMessagePreview: NOTE_PREVIEW');
    expect(
      code,
      'previewOf(text) в заметке означал бы, что обсуждение коллег видно в списке диалогов'
    ).not.toContain('previewOf(');
  });
});
