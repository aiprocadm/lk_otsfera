import { describe, it, expect } from 'vitest';
import { readSource } from './helpers/source';

/**
 * Страж ворот «файл уходит клиенту только после `clean`» (`У-204`, спека
 * этапа 3 §3.3).
 *
 * Почему текстовый, а не поведенческий. Поведение проверяют обычные тесты
 * (`messengers.attachment*`), но они ловят только то, что сегодня написано.
 * Регресс здесь выглядит безобидно: кто-то «ускоряет» отправку и добавляет
 * вызов транспорта прямо в загрузку — файл начинает уходить клиенту ДО
 * антивируса, и ни один тест доставки этого не заметит, потому что поведение
 * «после clean» тоже останется верным. Поэтому страж смотрит на структуру:
 * в приёме файла вызова транспорта быть не должно вовсе.
 *
 * Исходник читается через `readSource` (снимает комментарии): иначе
 * закомментированный вызов прошёл бы, а упоминание в пояснении — уронило.
 *
 * Проверено мутацией: добавление `await sendAttachmentToMessenger(...)` в
 * `sendDialogAttachment` роняет этот тест.
 */

const ATTACHMENT_SERVICE = 'src/lib/services/messengers/attachment.ts';

/** Тело функции от её объявления до следующего `export` верхнего уровня. */
function bodyOf(code: string, fnName: string): string {
  const start = code.indexOf(`export async function ${fnName}`);
  expect(start, `в ${ATTACHMENT_SERVICE} нет функции ${fnName}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const next = rest.indexOf('\nexport ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('вложение не уходит клиенту до проверки антивирусом', () => {
  it('приём файла от сотрудника не зовёт транспорт', () => {
    const code = readSource(ATTACHMENT_SERVICE);
    const upload = bodyOf(code, 'sendDialogAttachment');
    expect(
      upload,
      'sendDialogAttachment не должен отправлять файл: отправка — после clean, в deliverScannedAttachment'
    ).not.toContain('sendAttachmentToMessenger');
  });

  it('отправка проверенного файла сама проверяет статус и состояние доставки', () => {
    const code = readSource(ATTACHMENT_SERVICE);
    const deliver = bodyOf(code, 'deliverScannedAttachment');
    // Ворота: только `clean` и только сообщение, которое ещё не отправлено.
    expect(deliver).toContain("scanStatus !== 'clean'");
    expect(deliver).toContain("deliveryStatus !== 'pending'");
    expect(deliver).toContain('sendAttachmentToMessenger');
  });

  it('приём файла ставит сообщение в ожидание, а не в «отправлено»', () => {
    const code = readSource(ATTACHMENT_SERVICE);
    const upload = bodyOf(code, 'sendDialogAttachment');
    expect(upload).toContain("deliveryStatus: 'pending'");
    expect(upload).toContain("scanStatus: 'pending'");
    // «sent» в приёме означало бы, что история врёт: файл ещё никуда не ушёл.
    expect(upload).not.toContain("deliveryStatus: 'sent'");
  });
});
