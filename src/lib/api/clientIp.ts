/**
 * Адрес клиента за обратным прокси — один разбор на весь проект.
 *
 * Решение `Р-Б-15` (вопрос `В-3-12` этапа 3, делегирован заказчиком 16.09.2026).
 *
 * **Почему не первый элемент.** Заголовок `x-forwarded-for` — это список,
 * который растёт слева направо: каждый прокси дописывает в КОНЕЦ адрес того, от
 * кого получил запрос. Значит наш, проверенный, — последний; всё, что левее,
 * прислал сам клиент и может написать туда что угодно.
 *
 * До этой правки шесть мест брали ПЕРВЫЙ элемент. Последствия были разные и все
 * настоящие: счётчик попыток входа обходился одной строкой в заголовке (каждый
 * запрос выглядел «с нового адреса»), а белый список вебхука телефонии
 * проверялся против значения, которое звонящий сам же и подставил.
 *
 * **Сколько отрезать с конца** задаёт `TRUSTED_PROXY_HOPS` — число НАШИХ
 * прокси перед приложением (по умолчанию один: nginx). Если заголовок короче
 * ожидаемого — берём последний элемент: он ближе всех к нам и подделать его
 * труднее прочих.
 */

/** Один обратный прокси (nginx) — типовая раскладка стенда и прода. */
const DEFAULT_TRUSTED_HOPS = 1;

function trustedHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined) return DEFAULT_TRUSTED_HOPS;
  const parsed = Number(raw);
  // Мусор в переменной не должен молча превращаться в «доверяем всей цепочке»:
  // при непонятном значении возвращаемся к умолчанию.
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_TRUSTED_HOPS;
}

/**
 * Адрес клиента: элемент `x-forwarded-for` на `TRUSTED_PROXY_HOPS` позиций от
 * конца, иначе `x-real-ip`, иначе `'unknown'`.
 *
 * Пустой строки не возвращает: ключ счётчика и запись аудита должны быть
 * читаемыми, а `''` в журнале неотличим от «поля нет».
 */
export function clientIpFromHeaders(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hops.length > 0) {
      const index = hops.length - trustedHops();
      const ip = hops[index >= 0 ? index : hops.length - 1];
      if (ip) return ip;
    }
  }
  const real = headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : 'unknown';
}
