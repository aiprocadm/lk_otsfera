import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { clientIpFromHeaders } from '@/lib/api/clientIp';

/**
 * Адрес клиента за прокси: один разбор на весь проект (решение `Р-Б-15`,
 * вопрос `В-3-12` этапа 3).
 *
 * До этой правки шесть мест читали `x-forwarded-for` и все шесть брали ПЕРВЫЙ
 * элемент. Заголовок растёт слева направо — каждый прокси дописывает в конец
 * того, от кого получил запрос, — поэтому первый элемент прислал сам клиент.
 * Последствия были настоящие: счётчик попыток входа обходился строкой в
 * заголовке, а белый список вебхука телефонии проверялся против значения,
 * которое звонящий сам же и подставил.
 *
 * Мутация (проверено 16.09.2026): вернуть в помощнике `hops[0]` вместо отсчёта
 * с конца → падает «подделанное начало цепочки не считается адресом»; вернуть
 * чтение заголовка в любой роут → падает страж единственного места.
 */

const SRC = join(process.cwd(), 'src');
/** Единственный файл, которому положено знать про заголовки прокси. */
const OWNER = join('lib', 'api', 'clientIp.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...walk(full));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('страж: заголовки прокси читает ровно один помощник', () => {
  it('никто, кроме `lib/api/clientIp.ts`, не разбирает `x-forwarded-for`', () => {
    const offenders = walk(SRC)
      // Комментарии снимаем: про заголовок можно ПИСАТЬ где угодно, нельзя его
      // читать. Без этого страж ловил бы собственные пояснения в роутах.
      .filter((file) => !file.endsWith(OWNER))
      .filter((file) => /x-forwarded-for|x-real-ip/.test(readSource(file)))
      .map((file) => file.slice(SRC.length + 1));

    expect(
      offenders,
      'разбор адреса расползся по роутам — расхождения появятся при первой правке'
    ).toEqual([]);
  });
});

describe('clientIpFromHeaders', () => {
  const saved = process.env.TRUSTED_PROXY_HOPS;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = saved;
  });

  const ip = (value: string | null, real?: string): string =>
    clientIpFromHeaders(
      new Headers({
        ...(value !== null ? { 'x-forwarded-for': value } : {}),
        ...(real !== undefined ? { 'x-real-ip': real } : {}),
      })
    );

  it('один прокси, клиент ничего не подставил — его адрес и берём', () => {
    expect(ip('203.0.113.7')).toBe('203.0.113.7');
  });

  it('ПОДДЕЛАННОЕ начало цепочки не считается адресом', () => {
    // Клиент прислал `x-forwarded-for: 1.2.3.4`; nginx дописал настоящий адрес
    // в конец. Берём хвост — иначе злоумышленник меняет «свой» адрес на каждом
    // запросе и счётчик попыток не срабатывает никогда.
    expect(ip('1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
    expect(ip('1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('два наших прокси — отсчитываем два с конца', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(ip('1.2.3.4, 203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
  });

  it('цепочка короче ожидаемой — берём последний, он ближе всех к нам', () => {
    process.env.TRUSTED_PROXY_HOPS = '3';
    expect(ip('203.0.113.7')).toBe('203.0.113.7');
  });

  it('мусор в переменной не открывает доверие ко всей цепочке', () => {
    for (const bad of ['0', '-1', 'два', '1.5', '']) {
      process.env.TRUSTED_PROXY_HOPS = bad;
      expect(ip('1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
    }
  });

  it('пустые элементы и лишние пробелы не ломают разбор', () => {
    expect(ip(' 1.2.3.4 , , 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('без заголовка прокси берётся `x-real-ip`, иначе `unknown`', () => {
    expect(ip(null, '198.51.100.4')).toBe('198.51.100.4');
    expect(ip('', '198.51.100.4')).toBe('198.51.100.4');
    expect(ip(null)).toBe('unknown');
    expect(ip(null, '   ')).toBe('unknown');
  });
});
