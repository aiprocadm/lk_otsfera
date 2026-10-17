import { fmtDateTime } from '@/lib/format';

/**
 * Текст заметки из сообщения клиента (этап 6 ТЗ 13.10.2026, `У-310`,
 * `Р-6-10`): сначала слова менеджера, потом цитата — кто, когда и что
 * написал. Цитата копируется, а не ссылается: сообщение могут удалить, а
 * договорённость в заметке должна остаться.
 */
export function noteFromClientMessage(args: {
  comment: string;
  author: string;
  at: Date;
  body: string;
}): string {
  const comment = args.comment.trim();
  const quote = `Сообщение клиента (${args.author}, ${fmtDateTime(args.at)}):\n«${args.body}»`;
  return comment ? `${comment}\n\n${quote}` : quote;
}
