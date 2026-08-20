import { describe, it, expect } from 'vitest';
import {
  normalizeSnils,
  parseBirthDate,
  isValidEmail,
  validateEnrollmentItems,
} from '@/lib/services/enrollments/validate';

describe('normalizeSnils (решение §10: только формат 11 цифр)', () => {
  it('пусто/undefined/пробелы → ok, value=null (поле необязательное)', () => {
    expect(normalizeSnils(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeSnils(null)).toEqual({ ok: true, value: null });
    expect(normalizeSnils('   ')).toEqual({ ok: true, value: null });
  });
  it('маска XXX-XXX-XXX XX снимается → 11 цифр', () => {
    expect(normalizeSnils('112-233-445 95')).toEqual({ ok: true, value: '11223344595' });
    expect(normalizeSnils('11223344595')).toEqual({ ok: true, value: '11223344595' });
  });
  it('не 11 цифр или посторонние символы → ok:false', () => {
    expect(normalizeSnils('1234567890')).toEqual({ ok: false });
    expect(normalizeSnils('123456789012')).toEqual({ ok: false });
    expect(normalizeSnils('11a2334459x')).toEqual({ ok: false });
  });
});

describe('parseBirthDate', () => {
  it('пусто → ok, null', () => {
    expect(parseBirthDate('')).toEqual({ ok: true, value: null });
    expect(parseBirthDate(undefined)).toEqual({ ok: true, value: null });
  });
  it('ISO-дата → Date (UTC-полночь)', () => {
    expect(parseBirthDate('1990-01-02')).toEqual({
      ok: true,
      value: new Date('1990-01-02T00:00:00.000Z'),
    });
  });
  it('кривой формат / несуществующая дата / будущее → ok:false', () => {
    expect(parseBirthDate('02.01.1990')).toEqual({ ok: false });
    expect(parseBirthDate('1990-13-45')).toEqual({ ok: false });
    expect(parseBirthDate('2999-01-01')).toEqual({ ok: false });
  });

  it('несуществующий день месяца не «переезжает» на следующий', () => {
    // JS считает 30 февраля законной датой и отдаёт 2 марта. Через Excel-импорт
    // заявки так в личное дело попадала бы чужая дата рождения, без ошибок.
    expect(parseBirthDate('1990-02-30')).toEqual({ ok: false });
    expect(parseBirthDate('2025-04-31')).toEqual({ ok: false });
    expect(parseBirthDate('2023-02-29')).toEqual({ ok: false });
    // Високосный год — законная дата, её отвергать нельзя.
    expect(parseBirthDate('2024-02-29')).toMatchObject({ ok: true });
  });
});

describe('isValidEmail', () => {
  it('базовые случаи', () => {
    expect(isValidEmail('a@b.ru')).toBe(true);
    expect(isValidEmail('a b@b.ru')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });
});

describe('validateEnrollmentItems', () => {
  it('пустой список → русская ошибка', () => {
    expect(validateEnrollmentItems([])).toEqual({
      ok: false,
      errors: ['Добавьте хотя бы одного слушателя'],
    });
  });

  it('новый слушатель без ФИО/email → адресные ошибки по номеру строки', () => {
    const r = validateEnrollmentItems([
      { fullName: '', email: '' },
      { fullName: 'Иван', email: 'плохо' },
    ]);
    expect(r).toMatchObject({ ok: false });
    const errors = (r as { errors: string[] }).errors;
    expect(errors).toContain('Слушатель 1: не указано ФИО');
    expect(errors).toContain('Слушатель 1: не указан email');
    expect(errors.some((e) => e.includes('Слушатель 2: некорректный email'))).toBe(true);
  });

  it('кастомный label используется в сообщениях (для Excel-импорта PR-2)', () => {
    const r = validateEnrollmentItems([{ fullName: '', email: '' }], (i) => `Строка ${i + 2}`);
    expect((r as { errors: string[] }).errors[0]).toContain('Строка 2');
  });

  it('позиция со studentId не требует ФИО/email, но проверяет заполненный email', () => {
    const ok = validateEnrollmentItems([{ studentId: 'st1', directionId: 'd1' }]);
    expect(ok.ok).toBe(true);
    const bad = validateEnrollmentItems([{ studentId: 'st1', directionId: 'd1', email: 'плохо' }]);
    expect(bad.ok).toBe(false);
  });

  it('`У-36`: позиция без обучения — ошибка (шапочного направления больше нет)', () => {
    const r = validateEnrollmentItems([{ fullName: 'Иван', email: 'i@x.ru' }]);
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors).toContain('Слушатель 1: не выбрано обучение');
  });

  it('`requireDirection: false` — обучение не требуется (построчный Excel-импорт, `У-41`)', () => {
    const r = validateEnrollmentItems([{ fullName: 'Иван', email: 'i@x.ru' }], undefined, {
      requireDirection: false,
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.items[0]!.directionId).toBeNull();
  });

  it('СНИЛС и дата рождения валидируются только если заполнены', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Иван', email: 'i@x.ru', snils: '123', birthDate: 'зимой' },
    ]);
    const errors = (r as { errors: string[] }).errors;
    expect(errors.some((e) => e.includes('СНИЛС'))).toBe(true);
    expect(errors.some((e) => e.includes('дата рождения'))).toBe(true);
  });

  it('happy path: trim, lowercase email, нормализованный СНИЛС, null-поля', () => {
    const r = validateEnrollmentItems([
      {
        fullName: '  Иван Иванов ',
        email: ' I@X.RU ',
        position: '  ',
        snils: '112-233-445 95',
        birthDate: '1990-01-02',
        extra: ' примечание ',
        directionId: ' d1 ',
      },
    ]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items[0]).toEqual({
      studentId: null,
      directionId: 'd1',
      fullName: 'Иван Иванов',
      email: 'i@x.ru',
      position: null,
      snils: '11223344595',
      birthDate: new Date('1990-01-02T00:00:00.000Z'),
      extra: 'примечание',
    });
    expect(r.warnings).toEqual([]);
  });

  it('дубликаты email (регистронезависимо) и studentId склеиваются с warning', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Иван', email: 'i@x.ru', directionId: 'd1' },
      { fullName: 'Иван Дубль', email: 'I@X.RU', directionId: 'd1' },
      { studentId: 'st1', directionId: 'd1' },
      { studentId: 'st1', directionId: 'd1' },
    ]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(2);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('дубликат');
  });

  it('У-35: один человек на два РАЗНЫХ направления — две позиции, не дубликат', () => {
    const r = validateEnrollmentItems(
      [
        { fullName: 'Иван', email: 'i@x.ru', directionId: 'd1' },
        { fullName: 'Иван', email: 'I@X.RU', directionId: 'd2' },
        { fullName: 'Иван', email: 'i@x.ru', directionId: ' d1 ' },
        { studentId: 'st1', directionId: 'd1' },
        { studentId: 'st1' },
      ],
      undefined,
      { requireDirection: false }
    );
    if (!r.ok) throw new Error('expected ok');

    expect(r.items.map((i) => i.directionId)).toEqual(['d1', 'd2', 'd1', null]);
    // Повторами считаются только третья строка (тот же человек и то же
    // направление) — «без направления» и «с направлением» это разные позиции.
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('дубликат');
  });

  it('все позиции — дубликаты одной → остаётся одна (ошибки нет)', () => {
    const r = validateEnrollmentItems([
      { fullName: 'Иван', email: 'i@x.ru', directionId: 'd1' },
      { fullName: 'Иван', email: 'i@x.ru', directionId: 'd1' },
    ]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.items).toHaveLength(1);
  });
});
