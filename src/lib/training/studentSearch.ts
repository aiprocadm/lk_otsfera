import { normalizeName } from '@/lib/orders/certificateScanMatch';

/**
 * Поиск слушателя по ФИО вводом (этап 5 ТЗ 28.10.2026, `У-352`, РК 7): в
 * «Добавить слушателя» был только список для пролистывания, а слушателей у
 * организации бывают сотни.
 *
 * Каждое слово запроса должно найтись в ФИО или почте — в любом порядке и по
 * началу/середине слова: «иван петров», «Петров И» и «petrov@» находят
 * «Петров Иван Сергеевич». Регистр, «ё/е» и знаки препинания не мешают — та же
 * нормализация, что у сопоставления сканов удостоверений.
 */
export function filterStudentsByQuery<T extends { name: string; email: string | null }>(
  students: T[],
  query: string
): T[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (words.length === 0) return students;
  return students.filter((s) => {
    const haystack = normalizeName(`${s.name} ${s.email ?? ''}`);
    return words.every((w) => haystack.includes(w));
  });
}

/** Подпись в списке: почта — только если она есть (у слушателя она необязательна). */
export function studentOptionLabel(s: { name: string; email: string | null }): string {
  return s.email ? `${s.name} (${s.email})` : s.name;
}
