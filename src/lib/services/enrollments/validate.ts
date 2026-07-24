/**
 * Чистые валидаторы позиций заявки на обучение (этап 2, ФТ-2.1; решения
 * заказчика §10 спеки: доп. поля необязательные, СНИЛС — только формат 11 цифр).
 *
 * Русские сообщения ошибок — их же переиспользует Excel-импорт (PR-2) с
 * префиксом «Строка N: …». Ни одна функция не бросает исключений.
 */

export type EnrollmentItemInput = {
  /** Существующий сотрудник организации; при studentId ФИО/email копируются сервисом. */
  studentId?: string | null;
  fullName?: string | null;
  email?: string | null;
  position?: string | null;
  snils?: string | null;
  birthDate?: string | null;
  extra?: string | null;
};

export type ValidatedItem = {
  studentId: string | null;
  fullName: string;
  email: string;
  position: string | null;
  snils: string | null;
  birthDate: Date | null;
  extra: string | null;
};

export type ItemsValidation =
  | { ok: true; items: ValidatedItem[]; warnings: string[] }
  | { ok: false; errors: string[] };

// Простая практичная проверка (как в остальном проекте): что-то@что-то.домен.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** СНИЛС: пусто — ок (поле необязательное); иначе после снятия маски ровно 11 цифр. */
export function normalizeSnils(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  const digits = trimmed.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(digits)) return { ok: false };
  return { ok: true, value: digits };
}

/** Дата рождения: пусто — ок; иначе валидная дата не в будущем. Вход — ISO `YYYY-MM-DD` (date-инпут). */
export function parseBirthDate(raw: string | null | undefined): { ok: true; value: Date | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false };
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return { ok: false };
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
 * — дубликаты email внутри заявки склеиваются (первая позиция побеждает),
 *   об этом возвращается предупреждение (не ошибка).
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

    // Дедупликация: по email (для новых) или по studentId (для существующих).
    const dedupeKey = studentId ? `id:${studentId}` : email ? `email:${email}` : null;
    if (dedupeKey) {
      if (seenEmails.has(dedupeKey)) {
        warnings.push(`${name}: дубликат (${studentId ? 'сотрудник уже выбран' : email}) — объединён`);
        return;
      }
      seenEmails.add(dedupeKey);
    }

    items.push({
      studentId,
      fullName,
      email,
      position: input.position?.trim() || null,
      snils: snils.ok ? snils.value : null,
      birthDate: birthDate.ok ? birthDate.value : null,
      extra: input.extra?.trim() || null
    });
  });

  if (errors.length) return { ok: false, errors };
  if (!items.length) return { ok: false, errors: ['Добавьте хотя бы одного слушателя'] };
  return { ok: true, items, warnings };
}
