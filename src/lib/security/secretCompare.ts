import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time сравнение shared-секретов (webhook-заголовки, health-токен).
 * Оба значения прогоняются через sha256 до фиксированных 32 байт: так
 * timingSafeEqual никогда не бросает на разной длине, а сам тайминг сравнения
 * не зависит ни от длины, ни от префикса ожидаемого секрета.
 */
export function secretEquals(
  provided: string | null | undefined,
  expected: string
): boolean {
  if (provided == null) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
