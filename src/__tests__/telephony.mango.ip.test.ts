import { describe, it, expect } from 'vitest';
import { isMangoIpAllowed } from '@/lib/telephony/mango/ip';

/**
 * Разбор адреса из заголовков прокси переехал в общий `lib/api/clientIp.ts`
 * (решение `Р-Б-15`): белый список вебхука проверялся против ПЕРВОГО элемента
 * `x-forwarded-for`, то есть против значения, которое звонящий подставляет сам.
 * Его проверки живут в `api.client-ip.guardrail`.
 */
describe('isMangoIpAllowed', () => {
  it('accepts the 3 default Mango IPs', () => {
    expect(isMangoIpAllowed('81.88.80.132')).toBe(true);
    expect(isMangoIpAllowed('81.88.80.133')).toBe(true);
    expect(isMangoIpAllowed('81.88.82.36')).toBe(true);
  });

  it('rejects an IP not in the default allowlist', () => {
    expect(isMangoIpAllowed('1.2.3.4')).toBe(false);
  });

  it('tolerates a nullish ip (defensive ?? — denied)', () => {
    expect(isMangoIpAllowed(null as never)).toBe(false);
    expect(isMangoIpAllowed(undefined as never)).toBe(false);
  });

  it('restricts to an override allowlist string', () => {
    const override = '9.9.9.9';
    expect(isMangoIpAllowed('9.9.9.9', override)).toBe(true);
    expect(isMangoIpAllowed('81.88.80.132', override)).toBe(false);
  });
});
