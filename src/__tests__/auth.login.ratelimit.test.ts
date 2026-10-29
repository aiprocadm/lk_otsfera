/**
 * Tests the login rate-limiter (429) path.
 *
 * The loginAttempts Map is module-level state shared across all requests to
 * the same IP within the same module instance. We exhaust the default limit
 * (10) by firing 11 requests from the same IP, then assert the 11th is 429.
 *
 * We use a dedicated IP prefix so this file's requests don't collide with
 * the other login test files (which each get a fresh module instance).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, updateUser, compare, signToken } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateUser: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    // updateUser — отметка lastLoginAt (этап 9, ФТ-11.3)
    user: { findUnique, update: updateUser },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

function makeReq(body: object, ip = '1.2.3.4') {
  return new Request('https://app.local/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
  });
}

const adminUser = {
  id: 'u1',
  role: 'admin',
  companyId: null,
  partnerId: null,
  organizationId: null,
  email: 'admin@example.com',
  name: 'Admin',
  externalStudentId: null,
  passwordHash: 'hash',
};

beforeEach(() => {
  vi.resetAllMocks();
  compare.mockResolvedValue(true);
  signToken.mockResolvedValue('tok');
  findUnique.mockResolvedValue(adminUser);
  updateUser.mockResolvedValue({});
});

describe('login rate limiting', () => {
  it('allows normal requests (first 10 succeed)', async () => {
    const res = await POST(makeReq({ email: 'admin@example.com', password: 'x' }, '192.0.2.1'));
    expect(res.status).toBe(200);
  });

  it('returns 429 when the same IP exceeds 10 requests in the window', async () => {
    const ip = '192.0.2.99';
    // Fire 10 requests to fill the bucket (MAX_ATTEMPTS = 10 by default)
    for (let i = 0; i < 10; i++) {
      await POST(makeReq({ email: 'admin@example.com', password: 'x' }, ip));
    }
    // The 11th request should be rate-limited (count=11 > 10)
    const res = await POST(makeReq({ email: 'admin@example.com', password: 'x' }, ip));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });
});

/**
 * Предел попыток входа настраивается (`У-122`), и настройка может быть кривой.
 *
 * Кривое значение обязано **уйти в умолчание, а не отключить защиту**: `NaN`
 * или ноль в сравнении «попыток больше предела» даёт «никогда», то есть
 * подбирать пароль можно было бы бесконечно. Поэтому и проверка, и запасное
 * значение стоят рядом с чтением, а не «где-нибудь при старте».
 */
describe('предел попыток входа: настройка и запасное значение', () => {
  const ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ENV };
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');
    findUnique.mockResolvedValue(adminUser);
    updateUser.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...ENV };
  });

  it('свой предел из переменной сервера действует', async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '2';
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
    const ip = '192.0.2.11';

    for (let i = 0; i < 2; i++) {
      expect(
        (await POST(makeReq({ email: `admin+${ip}@example.com`, password: 'x' }, ip))).status
      ).toBe(200);
    }

    expect(
      (await POST(makeReq({ email: `admin+${ip}@example.com`, password: 'x' }, ip))).status
    ).toBe(429);
  });

  it.each([
    ['мусор', 'сколько-нибудь'],
    ['ноль', '0'],
    ['отрицательное', '-5'],
  ])('%s в настройке не отключает защиту — действует умолчание', async (_name, value) => {
    process.env.LOGIN_RATE_LIMIT_MAX = value;
    const ip = `192.0.2.${20 + value.length}`;

    // При «нуле как пределе» уже первый запрос дал бы 429, при `NaN` —
    // никогда. Умолчание 10 означает: третий запрос ещё проходит.
    for (let i = 0; i < 3; i++) {
      expect(
        (await POST(makeReq({ email: `admin+${ip}@example.com`, password: 'x' }, ip))).status
      ).toBe(200);
    }
  });

  it('кривое окно тоже уходит в умолчание', async () => {
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = 'полчаса';
    const ip = '192.0.2.40';

    expect(
      (await POST(makeReq({ email: `admin+${ip}@example.com`, password: 'x' }, ip))).status
    ).toBe(200);
  });
});

/**
 * `У-325` (ТЗ 28.10.2026, ДП §1 п. 6): подбор пароля одной учётной записи со
 * многих адресов упирается в счётчик по записи, а не только по IP.
 */
describe('предел попыток входа в одну учётную запись', () => {
  beforeEach(() => {
    compare.mockResolvedValue(false);
    findUnique.mockResolvedValue(adminUser);
    updateUser.mockResolvedValue({});
  });

  it('21-я попытка с 21-го адреса — 429 с кодом записи и сроком', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await POST(
        makeReq({ email: 'victim@example.com', password: 'x' }, `198.51.100.${i}`)
      );
      expect(res.status, `попытка ${i + 1} ещё не упирается в предел`).toBe(401);
    }

    const res = await POST(
      makeReq({ email: 'victim@example.com', password: 'x' }, '198.51.100.250')
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('900');
    const body = await res.json();
    expect(body).toMatchObject({ code: 'ACCOUNT_TOO_MANY_ATTEMPTS', retryAfterMinutes: 15 });
  });

  it('регистр букв в адресе не даёт обойти счётчик', async () => {
    for (let i = 0; i < 20; i++) {
      const email = i % 2 === 0 ? 'Target@Example.com' : 'target@example.com';
      await POST(makeReq({ email, password: 'x' }, `203.0.113.${i}`));
    }
    const res = await POST(
      makeReq({ email: 'TARGET@EXAMPLE.COM', password: 'x' }, '203.0.113.200')
    );
    expect(res.status).toBe(429);
  });
});
