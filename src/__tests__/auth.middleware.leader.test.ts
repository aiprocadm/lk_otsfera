import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('jose', () => ({ jwtVerify: vi.fn() }));

import { jwtVerify } from 'jose';
import { middleware } from '@/middleware';

function req(pathname: string, token?: string) {
  return {
    url: `https://app.local${pathname}`,
    nextUrl: { pathname },
    cookies: { get: vi.fn().mockReturnValue(token ? { value: token } : undefined) },
  } as any;
}

const ORIGINAL_ENV = {
  JWT_SECRET: process.env.JWT_SECRET,
  FEATURE_MANAGER_CABINET: process.env.FEATURE_MANAGER_CABINET,
  FEATURE_LEADER_CABINET: process.env.FEATURE_LEADER_CABINET,
};

// Модель ролей после PR-4 ТЗ 2026-08-17: руководитель — top-level роль
// `leader` (суб-роли managerRole больше нет). Прежний describe «обе модели
// эквивалентны» удалён как отработавшие леса: он проверял ту же самую роль
// `leader` вторым набором кейсов; уникальные кейсы оттуда перенесены сюда.
describe('middleware — роль leader и кабинет руководителя', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET = 'middleware-test-secret-with-at-least-32-chars';
    // Кабинет менеджера должен быть достижим в кейсах с редиректом на него.
    process.env.FEATURE_MANAGER_CABINET = '1';
    delete process.env.FEATURE_LEADER_CABINET;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('руководитель при FEATURE_LEADER_CABINET=1: / -> /leader/dashboard', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'leader' },
    } as any);

    const res = await middleware(req('/', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/leader/dashboard');
  });

  it('руководитель при выключенном флаге: / -> /manager/dashboard', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'leader' },
    } as any);

    const res = await middleware(req('/', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/manager/dashboard');
  });

  it('рядовой менеджер при включённом флаге: / -> /manager/dashboard (роль manager, не leader)', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'manager' } } as any);

    const res = await middleware(req('/', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/manager/dashboard');
  });

  it('руководитель при включённом флаге: /login -> /leader/dashboard (auth-страница)', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'leader' },
    } as any);

    const res = await middleware(req('/login', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/leader/dashboard');
  });

  it('partner на /leader/dashboard -> /forbidden (protectedPrefixes)', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'partner' } } as any);

    const res = await middleware(req('/leader/dashboard', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('руководитель на /leader/team при ВЫКЛЮЧЕННОМ флаге -> 404 (FEATURE_PREFIXES)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { role: 'leader' },
    } as any);

    const res = await middleware(req('/leader/team', 'tkn'));

    expect(res.status).toBe(404);
  });

  it('рядовой менеджер на /leader/team при включённом флаге -> /forbidden (protectedPrefixes["/leader"]=["leader"])', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'manager' } } as any);

    const res = await middleware(req('/leader/team', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });

  it('руководитель проходит в /manager/* («играющий тренер», Р-Л-3)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'leader' } } as any);

    const res = await middleware(req('/manager/orders', 'tkn'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('руководитель проходит в /leader/* при включённом флаге', async () => {
    process.env.FEATURE_LEADER_CABINET = '1';
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'leader' } } as any);

    const res = await middleware(req('/leader/team', 'tkn'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('руководитель НЕ проходит в /admin/* (Model A: чужой кабинет закрыт)', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { role: 'leader' } } as any);

    const res = await middleware(req('/admin/dashboard', 'tkn'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.local/forbidden');
  });
});
