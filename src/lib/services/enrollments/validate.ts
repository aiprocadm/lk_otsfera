/**
 * Чистые валидаторы позиций заявки на обучение (этап 2, ФТ-2.1; решения
 * заказчика §10 спеки: доп. поля необязательные, СНИЛС — только формат 11 цифр).
 *
 * Русские сообщения ошибок — их же переиспользует Excel-импорт (PR-2) с
 * префиксом «Строка N: …». Ни одна функция не бросает исключений.
 */

import { parseIsoCalendarDate } from '@/lib/dates/calendar';

export type EnrollmentItemInput = {
  /** Существующий сотрудник организации; при studentId ФИО/email копируются сервисом. */
  studentId?: string | null;
  /**
   * У-33 (этап 6): направление обучения теперь у ПОЗИЦИИ, а не у заявки —
   * иначе нельзя одной заявкой отправить одного на электробезопасность, а
   * другого на работы на высоте (решение Р-5).
   */
  directionId?: string | null;
  fullName?: string | null;
  email?: string | null;
  position?: string | null;
  snils?: string | null;
  birthDate?: string | null;
  extra?: string | null;
};

export type ValidatedItem = {
  studentId: string | null;
  directionId: string | null;
  fullName: string;
  email: string;
  position: string | null;
  snils: string | null;
  birthDate: Date | null;
  extra: string | null;
};

export type ItemsValidation =
  { ok: true; items: ValidatedItem[]; warnings: string[] } | { ok: false; errors: string[] };

// Простая практичная проверка (как в остальном проекте): что-то@что-то.домен.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** СНИЛС: пусто — ок (поле необязательное); иначе после снятия маски ровно 11 цифр. */
export function normalizeSnils(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(digits)) return { ok: false };
  return { ok: true, value: digits };
}

/** Дата рождения: пусто — ок; иначе валидная дата не в будущем. Вход — ISO `YYYY-MM-DD` (date-инпут). */
export function parseBirthDate(
  raw: string | null | undefined
): { ok: true; value: Date | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  // `parseIsoCalendarDate` отвергает и несуществующие дни: «31.04» иначе
  // молча превратилось бы в 1 мая — чужая дата рождения в личном деле.
  const d = parseIsoCalendarDate(trimmed);
  if (!d) return { ok: false };
  if (d.getTime() > Date.now()) return { ok: false };
  return { ok: true, value: d };
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw);
}

/**
 * Валидация набора позиций перед созданием заявки. Правила:
 * — хотя бы одна позиция;
 * — для новых слушателей ФИО и email обязательны; email — валидный;
 * — СНИЛС/дата рождения проверяются, только если заполнены;
 * — дубликаты склеиваются по паре «слушатель + направление» (первая позиция
 *   побеждает), об этом возвращается предупреждение (не ошибка). Один и тот же
 *   человек с РАЗНЫМИ направлениями — это две законные позиции (У-35).
 * `label` — как называть позицию в сообщении (по умолчанию «Слушатель N»).
 */
export function validateEnrollmentItems(
  inputs: EnrollmentItemInput[],
  label: (index: number) => string = (i) => `Слушатель ${i + 1}`
): ItemsValidation {
  if (!inputs.length) return { ok: false, errors: ['Добавьте хотя бы одного слушателя'] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const seenEmails = new Set<string>();
  const items: ValidatedItem[] = [];

  inputs.forEach((input, i) => {
    const name = label(i);
    const studentId = input.studentId?.trim() || null;
    const fullName = input.fullName?.trim() ?? '';
    const email = input.email?.trim().toLowerCase() ?? '';

    // Для studentId ФИО/email подставит сервис из Student — здесь не требуем.
    if (!studentId) {
      if (!fullName) errors.push(`${name}: не указано ФИО`);
      if (!email) errors.push(`${name}: не указан email`);
      else if (!isValidEmail(email)) errors.push(`${name}: некорректный email «${email}»`);
    } else if (email && !isValidEmail(email)) {
      errors.push(`${name}: некорректный email «${email}»`);
    }

    const snils = normalizeSnils(input.snils);
    if (!snils.ok) errors.push(`${name}: СНИЛС должен содержать 11 цифр`);

    const birthDate = parseBirthDate(input.birthDate);
    if (!birthDate.ok) errors.push(`${name}: некорректная дата рождения`);

    // У-35 (этап 6): ключ дедупликации — «слушатель + направление». Один
    // человек может учиться двум разным вещам в одной заявке, но дважды одному
    // и тому же — нет. До этапа 6 ключом был только слушатель.
    const directionId = input.directionId?.trim() || null;
    // `У-36`: направления на шапке заявки больше нет, подставлять позиции
    // нечего — значит каждая строка обязана назвать своё обучение сама.
    // Раньше пустое значение молча заменялось шапочным; теперь это ошибка
    // формы, а не 500-я от обязательной колонки `EnrollmentRequestItem`.
    if (!directionId) errors.push(`${name}: не выбрано обучение`);
    const who = studentId ? `id:${studentId}` : email ? `email:${email}` : null;
    const dedupeKey = who ? `${who}|dir:${directionId ?? ''}` : null;
    if (dedupeKey) {
      if (seenEmails.has(dedupeKey)) {
        warnings.push(
          `${name}: дубликат (${studentId ? 'сотрудник уже выбран' : email}) с тем же направлением — объединён`
        );
        return;
      }
      seenEmails.add(dedupeKey);
    }

    items.push({
      studentId,
      directionId,
      fullName,
      email,
      position: input.position?.trim() || null,
      snils: snils.ok ? snils.value : null,
      birthDate: birthDate.ok ? birthDate.value : null,
      extra: input.extra?.trim() || null,
    });
  });

  if (errors.length) return { ok: false, errors };
  // Второй проверки «список пуст» здесь быть не может: она стоит выше, до цикла.
  // Если позиции пришли и ни одна не дала ошибки, первая гарантированно попала в
  // items (дедуп отбрасывает только повтор уже виденного ключа, а первая позиция
  // виденной быть не может). Ф2 программы покрытия: недостижимую ветку удаляем,
  // а не «покрываем» подгонкой теста.
  return { ok: true, items, warnings };
}
