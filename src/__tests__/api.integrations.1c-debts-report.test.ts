import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Отчёт «Расхождения по дебиторке» в Excel (`У-257`, этап 8).
 *
 * Дверь та же, что у пакета документов для 1С: право раздела
 * `integrations.oneC`. Роут тонкий — сессия, право, сервис, файл. Проверяется
 * дверь (гость и чужой), подстановка `logId` и то, что имя файла уезжает
 * закодированным: русское имя без кодировки часть браузеров сохраняет
 * знаками вопроса.
 */
const { getSession, canAccessSettingsSection, buildDebtsReport } = vi.hoisted(() => ({
  getSession: vi.fn(),
  canAccessSettingsSection: vi.fn(),
  buildDebtsReport: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));
vi.mock('@/lib/navigation/settings', () => ({
  SETTINGS_SECTIONS: [{ id: 'integrations.oneC', title: 'Обмен с 1С' }],
}));
vi.mock('@/lib/services/oneCSync/debtsReport', () => ({ buildDebtsReport }));

import { GET } from '@/app/api/integrations/1c/debts/report/route';
import type { NextRequest } from 'next/server';

const SESSION = { sub: 'u1', role: 'admin', email: 'a@x.ru' };

function req(url = 'http://localhost/api/integrations/1c/debts/report'): NextRequest {
  return { nextUrl: new URL(url) } as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  canAccessSettingsSection.mockReturnValue(true);
});

describe('GET /api/integrations/1c/debts/report', () => {
  it('гость получает 401', async () => {
    getSession.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(buildDebtsReport).not.toHaveBeenCalled();
  });

  it('без права раздела — 403', async () => {
    canAccessSettingsSection.mockReturnValue(false);

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(canAccessSettingsSection).toHaveBeenCalledWith(SESSION, {
      id: 'integrations.oneC',
      title: 'Обмен с 1С',
    });
  });

  it('сверки ещё не было — 404 с человеческим объяснением', async () => {
    buildDebtsReport.mockResolvedValue({ ok: false, error: 'not_found' });

    const res = await GET(req());

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'not_found',
      message: 'Сверка дебиторки ещё не проводилась.',
    });
  });

  it('без logId берётся последняя сверка; русское имя файла уезжает закодированным', async () => {
    buildDebtsReport.mockResolvedValue({
      ok: true,
      buffer: Buffer.from('файл'),
      fileName: 'Расхождения.xlsx',
      mismatches: 3,
    });

    const res = await GET(req());

    expect(buildDebtsReport).toHaveBeenCalledWith({}, { logId: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Расхождения.xlsx')}`
    );
    expect(res.headers.get('x-debt-mismatches')).toBe('3');
    expect(await res.arrayBuffer()).toEqual(new Uint8Array(Buffer.from('файл')).buffer);
  });

  it('с logId отчёт строится по конкретной сверке', async () => {
    buildDebtsReport.mockResolvedValue({
      ok: true,
      buffer: Buffer.from('x'),
      fileName: 'a.xlsx',
      mismatches: 0,
    });

    await GET(req('http://localhost/api/integrations/1c/debts/report?logId=log-9'));

    expect(buildDebtsReport).toHaveBeenCalledWith({}, { logId: 'log-9' });
  });
});
