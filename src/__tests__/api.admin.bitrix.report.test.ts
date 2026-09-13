import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/admin/bitrix/<пакет>/report` — скачивание отчёта сверки переноса
 * (`У-198`, этап 2 ТЗ 12.09.2026).
 *
 * Роут тонкий, но несёт три обязанности, и проверяются именно они:
 *  1. гарды по порядку — флаг `bitrix_migration`, затем роль, и только потом
 *     поход в базу за пакетом;
 *  2. чужой пакет, пропавший пакет и несобранный отчёт выглядят одинаково —
 *     404 `not_found`, без похода в хранилище;
 *  3. в отчёте лежат имена и телефоны перенесённых контактов, поэтому его
 *     скачивание — чтение ПДн: событие журнала (§25.7) пишется РАНЬШЕ, чем
 *     выдаётся подписанная ссылка, иначе данные ушли, а записи о них нет.
 *
 * Файл наружу не отдаётся: как все документы проекта (§10), отчёт уезжает
 * подписанной ссылкой на 10 минут.
 */
const {
  notFoundIfDisabled,
  requireSettingsSection,
  findUnique,
  recordPiiAccess,
  recordAudit,
  createSignedUrl,
  logError,
} = vi.hoisted(() => ({
  notFoundIfDisabled: vi.fn(),
  requireSettingsSection: vi.fn(),
  findUnique: vi.fn(),
  recordPiiAccess: vi.fn(),
  recordAudit: vi.fn(),
  createSignedUrl: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
// Гард раздела, а не просто роли: у администратора с закрытыми «Интеграциями»
// кнопок нет — и прямая ссылка на отчёт с ПДн работать не должна (§4).
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { bitrixImportBatch: { findUnique } } }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    createSignedUrl,
    upload: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));

import { NextResponse } from 'next/server';
import { GET } from '@/app/api/admin/bitrix/[batchId]/report/route';

const SESSION = { sub: 'u-admin', role: 'admin' as const, companyId: 'c1' };
/** Ключ в хранилище — служебный путь, наружу и в логи он не ходит. */
const REPORT_PATH = 'bitrix-import/c1/b-1/report.xlsx';
const SIGNED_URL = 'https://s3.local/documents/b-1-report.xlsx?X-Amz-Signature=deadbeef';
/** TTL подписанной ссылки — 10 минут, как у остальных документов (§10). */
const TTL = 600;
const BATCH = { id: 'b-1', companyId: 'c1', reportPath: REPORT_PATH };

const req = (): Request => new Request('https://app.local/api/admin/bitrix/b-1/report');
const ctx = (batchId = 'b-1') => ({ params: Promise.resolve({ batchId }) });

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null); // флаг включён
  requireSettingsSection.mockResolvedValue(SESSION);
  findUnique.mockResolvedValue(BATCH);
  recordPiiAccess.mockResolvedValue(undefined);
  recordAudit.mockResolvedValue(undefined);
  createSignedUrl.mockResolvedValue(SIGNED_URL);
});

describe('GET /api/admin/bitrix/[batchId]/report — гарды', () => {
  it('флаг выключен → отдаётся ровно ответ notFoundIfDisabled, до базы дело не доходит', async () => {
    const gate = NextResponse.json({ error: 'not_found' }, { status: 404 });
    notFoundIfDisabled.mockReturnValue(gate);

    const res = await GET(req(), ctx());

    expect(res).toBe(gate);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(requireSettingsSection).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('не админ → requireSettingsSection уводит редиректом ДО чтения пакета', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(GET(req(), ctx())).rejects.toThrow('NEXT_REDIRECT');
    // Ни одной строки о чужом пакете не прочитано — гард стоит раньше базы.
    expect(findUnique).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

/**
 * Все три «нет отчёта» отвечают одинаково: существование чужих пакетов — не
 * дело этого администратора, а отличать «пакета нет» от «отчёт ещё не собран»
 * наружу незачем (экран и так знает, когда кнопка неактивна).
 */
describe('GET /api/admin/bitrix/[batchId]/report — чего наружу не показываем', () => {
  it('пакет чужой компании → 404 not_found, ссылка не запрашивалась', async () => {
    findUnique.mockResolvedValue({ id: 'b-1', companyId: 'c2', reportPath: REPORT_PATH });

    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('пакета нет вовсе → тот же 404 not_found', async () => {
    findUnique.mockResolvedValue(null);

    const res = await GET(req(), ctx('нет-такого'));

    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'нет-такого' },
      select: { id: true, companyId: true, reportPath: true },
    });
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('отчёт ещё не собран (reportPath пуст) → 404, ссылка не запрашивалась', async () => {
    findUnique.mockResolvedValue({ id: 'b-1', companyId: 'c1', reportPath: null });

    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/bitrix/[batchId]/report — успех', () => {
  it('пакет читается узким селектом по идентификатору из адреса', async () => {
    await GET(req(), ctx());

    expect(requireSettingsSection).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      select: { id: true, companyId: true, reportPath: true },
    });
  });

  it('ссылка подписывается на ключ отчёта, на 10 минут и «как вложение»', async () => {
    await GET(req(), ctx());

    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(REPORT_PATH, TTL, { download: true });
  });

  it('ответ — 307 на подписанную ссылку, а не сам файл (§10)', async () => {
    const res = await GET(req(), ctx());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(SIGNED_URL);
  });

  it('§25.7: журнал ПДн получает РОВНО одно событие — контекст bitrix_report и id пакета', async () => {
    await GET(req(), ctx());

    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).toHaveBeenCalledWith(expect.anything(), {
      session: SESSION,
      context: 'bitrix_report',
      subjectIds: ['b-1'],
    });
  });

  it('§25.7: запись в журнал ПДн идёт РАНЬШЕ выдачи ссылки', async () => {
    await GET(req(), ctx());

    // Иначе возможен порядок «файл выдали — записать не успели»: данные ушли,
    // а следа в журнале нет. Обратный перекос безопасен (см. отказ хранилища).
    expect(recordPiiAccess.mock.invocationCallOrder[0]!).toBeLessThan(
      createSignedUrl.mock.invocationCallOrder[0]!
    );
  });

  it('аудит: скачивание отчёта — отдельное событие пакета миграции', async () => {
    await GET(req(), ctx());

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u-admin',
        action: 'bitrix_import_report_downloaded',
        entity: 'bitrix_import_batch',
        entityId: 'b-1',
      })
    );
  });

  it('ни ключ хранилища, ни подписанная ссылка не попадают в аудит', async () => {
    await GET(req(), ctx());

    const written = JSON.stringify(recordAudit.mock.calls[0]![1]);
    expect(written).not.toContain(REPORT_PATH);
    expect(written).not.toContain(SIGNED_URL);
  });
});

describe('GET /api/admin/bitrix/[batchId]/report — отказ хранилища', () => {
  it('подпись не выдана → 502 storage, аудит не пишется', async () => {
    createSignedUrl.mockRejectedValue(new Error('STORAGE_SIGN: провайдер недоступен'));

    const res = await GET(req(), ctx());

    expect(res.status).toBe(502);
    expect(await body(res)).toEqual({ error: 'storage' });
    // Скачивания не было — событию аудита взяться неоткуда.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('в лог уходит пакет и причина провайдера — без ссылки и без ключа хранилища', async () => {
    createSignedUrl.mockRejectedValue(new Error('STORAGE_SIGN: провайдер недоступен'));

    await GET(req(), ctx());

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('[admin/bitrix/report] подписанная ссылка не выдана', {
      batchId: 'b-1',
      providerError: 'STORAGE_SIGN: провайдер недоступен',
    });
    const logged = JSON.stringify(logError.mock.calls[0]);
    expect(logged).not.toContain(SIGNED_URL);
    expect(logged).not.toContain('X-Amz-Signature');
    expect(logged).not.toContain(REPORT_PATH);
  });

  it('не-Error от провайдера тоже становится строкой причины, а не падением роута', async () => {
    createSignedUrl.mockRejectedValue('провайдер вернул строку');

    const res = await GET(req(), ctx());

    expect(res.status).toBe(502);
    expect(logError).toHaveBeenCalledWith('[admin/bitrix/report] подписанная ссылка не выдана', {
      batchId: 'b-1',
      providerError: 'провайдер вернул строку',
    });
  });

  it('событие ПДн уже записано — перекос в сторону лишней записи сознательный', async () => {
    createSignedUrl.mockRejectedValue(new Error('STORAGE_SIGN: провайдер недоступен'));

    await GET(req(), ctx());

    // Журнал доступа пишется до выдачи ссылки, поэтому неудачная попытка тоже
    // оставляет след. Это безопасная сторона: лучше запись без чтения, чем
    // чтение без записи.
    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
  });
});
