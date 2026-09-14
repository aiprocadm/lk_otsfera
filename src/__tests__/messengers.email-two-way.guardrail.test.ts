import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * Страж двусторонней почты (`У-205`, спека этапа 3 §3.4).
 *
 * До этапа 3 ответ на письмо был невозможен, и это «нельзя» жило в ЧЕТЫРЁХ
 * местах сразу: код ошибки `email_unsupported`, его русский текст, подсказка
 * вместо формы в списке «Входящих» и скрытый режим ответа в ленте сделки.
 * Убрать надо было все четыре — оставь любое, и кнопка ответа не появится
 * (или появится и будет врать). Именно такой «полузакрытый» дефект обычные
 * тесты пропускают: каждый из них проверяет свой экран.
 *
 * Поэтому страж следит за исчезновением кода целиком и за тем, что ответ по
 * почте действительно собирается — с `Reply-To` и `In-Reply-To`.
 *
 * Исходники читаются через `readSource` (снимает комментарии): иначе
 * упоминание старого кода в пояснении уронило бы тест.
 *
 * Проверено мутацией: возврат ветки `return { ok: false }` для `email` в
 * `reply.ts` роняет третий тест.
 */

const SRC = 'src';
const REPLY = 'src/lib/services/inbound/reply.ts';
const EMAIL_REPLY = 'src/lib/services/inbound/emailReply.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Тесты пропускаем: они вправе упоминать старое поведение в названиях.
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('почта отвечает так же, как остальные каналы', () => {
  it('кода «ответ по почте не поддерживается» не осталось нигде в боевом коде', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      readSource(file).includes('email_unsupported')
    );
    expect(
      offenders,
      `«email_unsupported» — след запрета, снятого требованием У-205:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('форма ответа в «Входящих» не делает исключения для почты', () => {
    const code = readSource('src/components/manager/inbox-list.tsx');
    // Раньше здесь стояла подсказка «ответьте из почтового клиента».
    expect(code).not.toContain('Ответ по email пока недоступен');
  });

  it('ветка почты действительно отправляет письмо, а не отказ', () => {
    // Проверяем ИМЕННО ветку `case 'email'`, а не наличие импорта: импорт
    // переживает возврат заглушки `return { ok: false }`, и страж, который
    // смотрел бы на весь файл, спокойно прошёл бы по сломанному коду.
    // Проверено мутацией — в первой редакции этого стража так и было.
    const code = readSource(REPLY);
    const start = code.indexOf("case 'email':");
    expect(start, "в reply.ts нет ветки case 'email'").toBeGreaterThan(-1);
    const rest = code.slice(start + 1);
    const nextCase = rest.search(/\n\s*(case |default:)/);
    const branch = nextCase === -1 ? rest : rest.slice(0, nextCase);
    expect(branch, 'ветка почты должна звать отправку письма').toContain('sendEmailReply');
    expect(branch, 'заглушка-отказ в ветке почты означает, что У-205 не выполнен').not.toMatch(
      /return\s*{\s*ok:\s*false\s*}/
    );
  });

  it('ответ несёт Reply-To на входящий ящик и In-Reply-To на письмо клиента', () => {
    const code = readSource(EMAIL_REPLY);
    // Без Reply-To ответ клиента уйдёт на no-reply и переписка оборвётся.
    expect(code).toContain("getSettingValue(prisma, 'imap.user')");
    expect(code).toContain('replyTo');
    // Без In-Reply-To ответ встанет отдельным письмом, а не в ту же ветку.
    expect(code).toContain('inReplyTo');
  });
});
