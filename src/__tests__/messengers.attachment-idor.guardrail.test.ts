import { describe, it, expect } from 'vitest';
import { readSource } from './helpers/source';

/**
 * Страж доступа к вложениям диалога (`У-204`, `У-217`).
 *
 * Скачивание — единственное место, где файл переписки покидает систему, и у
 * него ТРИ независимые проверки. Каждую легко потерять при рефакторинге, и
 * потеря любой из них не ломает «счастливый путь» — поэтому обычные тесты
 * регресс поймают не всегда, а страж поймает всегда:
 *
 * 1. сообщение принадлежит ИМЕННО открытому диалогу (иначе чужой `messageId`,
 *    подставленный в адрес своего диалога, отдал бы чужой файл);
 * 2. диалог в скоупе сотрудника (чужая компания — отказ);
 * 3. ключ файла лежит под своим префиксом (страховка от данных, заведённых
 *    мимо сервиса).
 *
 * Плюс сам роут обязан отвечать 410 на заражённый файл, а не 404: это разные
 * сигналы (CLAUDE.md §10), и подмена одного другим прячет заражение.
 *
 * Проверено мутацией: удаление сверки `message.dialogId !== args.dialogId`
 * роняет первый тест.
 */

const SERVICE = 'src/lib/services/messengers/attachment.ts';
const ROUTE = 'src/app/api/manager/messengers/[id]/attachment/[messageId]/route.ts';

describe('скачивание вложения диалога — три проверки и честные коды', () => {
  it('сообщение сверяется с открытым диалогом', () => {
    const code = readSource(SERVICE);
    expect(
      code,
      'без сверки чужой messageId в адресе своего диалога отдал бы чужой файл'
    ).toContain('message.dialogId !== args.dialogId');
  });

  it('диалог проверяется по скоупу сотрудника', () => {
    const code = readSource(SERVICE);
    expect(code).toContain('isDialogInScope(session, message.dialog)');
  });

  it('ключ файла обязан лежать под префиксом вложений', () => {
    const code = readSource(SERVICE);
    expect(code).toContain('startsWith(ATTACHMENT_PREFIX)');
  });

  it('роут различает «заражён» (410), «ещё проверяется» (409) и «нет» (404)', () => {
    const code = readSource(ROUTE);
    expect(code).toContain('410');
    expect(code).toContain('409');
    expect(code).toContain('404');
    // Файл не проксируется приложением — только подписанная ссылка (§10).
    expect(code).toContain('Response.redirect');
  });
});
