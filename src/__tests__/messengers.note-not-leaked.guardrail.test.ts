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
        // Выборка есть — значит рядом должен стоять фильтр направления.
        if (!code.includes('direction')) offenders.push(file);
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
