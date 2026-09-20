import { describe, it, expect } from 'vitest';
import { isUniqueViolationOn } from '@/lib/db/uniqueViolation';

/**
 * Разбор `P2002` — «поле уже занято».
 *
 * Помощник маленький, но стоит на дороге у каждой формы с уникальным полем:
 * ошибся он — и человек вместо подсказки «такая почта уже есть» получает
 * падение. Опаснее всего два края: чужое ограничение, которое нельзя выдать
 * за своё, и отсутствующий `meta.target`, который нельзя превратить в строку
 * «undefined» — иначе поиск поля `defi` внутри неё случайно совпал бы.
 */
describe('isUniqueViolationOn', () => {
  const err = (target: unknown) => ({ code: 'P2002', meta: { target } });

  it('имя ограничения содержит поле — это наш случай', () => {
    expect(isUniqueViolationOn(err('User_email_key'), 'email')).toBe(true);
  });

  it('список полей от Postgres тоже разбирается', () => {
    expect(isUniqueViolationOn(err(['organizationId', 'email']), 'email')).toBe(true);
  });

  it('регистр не важен', () => {
    expect(isUniqueViolationOn(err('Organization_INN_key'), 'inn')).toBe(true);
  });

  it('чужое ограничение — не наше дело', () => {
    expect(isUniqueViolationOn(err('User_phone_key'), 'email')).toBe(false);
  });

  it('ошибка без meta.target не выдаётся за совпадение', () => {
    // Без этого края `String(undefined)` дал бы строку «undefined», и запрос
    // поля с именем `defi`, `unde` или `fine` внезапно совпал бы с ней.
    expect(isUniqueViolationOn({ code: 'P2002' }, 'email')).toBe(false);
    expect(isUniqueViolationOn({ code: 'P2002', meta: {} }, 'undefined')).toBe(false);
  });

  it('другой код ошибки и не-объекты отсекаются сразу', () => {
    expect(isUniqueViolationOn(err('User_email_key'), 'email')).toBe(true);
    expect(isUniqueViolationOn({ code: 'P2003', meta: { target: 'email' } }, 'email')).toBe(false);
    expect(isUniqueViolationOn(new Error('boom'), 'email')).toBe(false);
    expect(isUniqueViolationOn(null, 'email')).toBe(false);
    expect(isUniqueViolationOn('P2002', 'email')).toBe(false);
  });
});
