/**
 * Контрольные суммы реквизитов (`У-156`, этап 6; дефект `Д-11`).
 *
 * До этого ОГРН и счёт проверялись только по длине: опечатка в одной цифре
 * проходила молча и уезжала в счёт клиенту. Здесь — официальные алгоритмы;
 * ИНН живёт отдельно (`oneCSync/inn.ts`) и переиспользуется как есть.
 *
 * Все функции считают, что на вход подали строку только из цифр нужной длины
 * (длину проверяет вызывающий): «пусто» и «не 13 цифр» — это другая ошибка с
 * другим текстом для человека.
 */

/**
 * ОГРН (13 цифр) и ОГРНИП (15): последняя цифра — остаток от деления числа
 * без неё на 11 (для ОГРНИП — на 13), взятый по модулю 10.
 */
export function isValidOgrn(value: string): boolean {
  if (/^\d{13}$/.test(value)) {
    return (Number(value.slice(0, 12)) % 11) % 10 === Number(value[12]);
  }
  if (/^\d{15}$/.test(value)) {
    return (Number(value.slice(0, 14)) % 13) % 10 === Number(value[14]);
  }
  return false;
}

/** Общая часть: 23 цифры (префикс + счёт) с весами 7·1·3 и суммой, кратной 10. */
function accountChecksum(prefix: string, account: string): boolean {
  const digits = prefix + account;
  const weights = [7, 1, 3];
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // Индекс доказуемо валиден: длину строки проверил вызывающий (3 + 20).
    sum += (Number(digits[i]!) * weights[i % 3]!) % 10;
  }
  return sum % 10 === 0;
}

/**
 * Расчётный счёт (20 цифр) — по БИК банка.
 *
 * Префикс — последние три цифры БИК; но если это 001…050, счёт открыт в
 * подразделении Банка России, и префикс берётся из 5–6 цифр БИК с нулём
 * впереди (правило 579-П). Перепутать эти два случая — обычный способ
 * «валидатор ругается на верный счёт».
 */
export function isValidBankAccount(account: string, bic: string): boolean {
  if (!/^\d{20}$/.test(account) || !/^\d{9}$/.test(bic)) return false;
  const last3 = bic.slice(6, 9);
  const numeric = Number(last3);
  const prefix = numeric >= 1 && numeric <= 50 ? `0${bic.slice(4, 6)}` : last3;
  return accountChecksum(prefix, account);
}

/**
 * Корреспондентский счёт (20 цифр) — префикс всегда «0» + 5–6 цифры БИК.
 * Другой алгоритм, чем у расчётного: проверять корсчёт правилом расчётного —
 * значит браковать верные реквизиты.
 */
export function isValidCorrAccount(account: string, bic: string): boolean {
  if (!/^\d{20}$/.test(account) || !/^\d{9}$/.test(bic)) return false;
  return accountChecksum(`0${bic.slice(4, 6)}`, account);
}
