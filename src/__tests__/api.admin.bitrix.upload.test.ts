import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/admin/bitrix/upload` (`У-189` file) — тонкий роут: флаг → админ →
 * разбор формы → сервис → код в статус. Multipart НЕ мокается: тест шлёт
 * настоящий `Request` с `FormData`, чтобы проверить, что именно доезжает до
 * сервиса (имя, тип, размер, буфер).
 */
const { notFoundIfDisabled, requireAdmin, storeBitrixUploads } = vi.hoisted(() => ({
  notFoundIfDisabled: vi.fn(),
  requireAdmin: vi.fn(),
  storeBitrixUploads: vi.fn(),
}));

vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('@/lib/services/bitrix/upload', () => ({ storeBitrixUploads }));

import { NextResponse } from 'next/server';
import { POST } from '@/app/api/admin/bitrix/upload/route';

const URL_ = 'https://app.local/api/admin/bitrix/upload';

const COMPANIES_CSV = 'ID;Название компании\n1;ООО Ромашка\n';

function csvFile(name: string, content = COMPANIES_CSV): File {
  return new File([content], name, { type: 'text/csv' });
}

function formReq(files: File[]): Request {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  return new Request(URL_, { method: 'POST', body: fd });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  requireAdmin.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
  storeBitrixUploads.mockResolvedValue({ ok: true, files: [] });
});

describe('POST /api/admin/bitrix/upload — гарды', () => {
  it('флаг выключен → отдаётся ровно ответ notFoundIfDisabled, админ не спрашивается', async () => {
    const gate = NextResponse.json({ error: 'not_found' }, { status: 404 });
    notFoundIfDisabled.mockReturnValue(gate);

    const res = await POST(formReq([csvFile('companies.csv')]));

    expect(res).toBe(gate);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'not_found' });
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(storeBitrixUploads).not.toHaveBeenCalled();
  });

  it('не админ → requireAdmin уводит редиректом, сервис не зовётся', async () => {
    requireAdmin.mockRejectedValue(new Error('REDIRECT'));
    await expect(POST(formReq([csvFile('companies.csv')]))).rejects.toThrow('REDIRECT');
    expect(storeBitrixUploads).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/bitrix/upload — разбор формы', () => {
  it('тело не multipart → 400 invalid_request, сервис не зовётся', async () => {
    const res = await POST(new Request(URL_, { method: 'POST', body: 'x' }));

    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: 'invalid_request' });
    expect(storeBitrixUploads).not.toHaveBeenCalled();
  });

  it('форма без файлов → сервис получает пустой список и отвечает no_files', async () => {
    storeBitrixUploads.mockResolvedValue({ ok: false, error: 'no_files' });
    const res = await POST(formReq([]));

    expect(storeBitrixUploads).toHaveBeenCalledWith([]);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: 'no_files' });
  });

  it('сервис получает файлы с name/type/size/buffer; пустой файл отбрасывается', async () => {
    const res = await POST(
      formReq([
        csvFile('companies.csv'),
        csvFile('contacts.csv', 'ID;Имя;Фамилия\n2;Анна;Иванова\n'),
        new File([], 'empty.csv', { type: 'text/csv' }),
      ])
    );

    expect(res.status).toBe(200);
    expect(storeBitrixUploads).toHaveBeenCalledTimes(1);
    const [sent] = storeBitrixUploads.mock.calls[0] as [
      Array<{ name: string; type: string; size: number; buffer: Buffer }>,
    ];
    expect(sent).toHaveLength(2);
    expect(sent.map((f) => f.name)).toEqual(['companies.csv', 'contacts.csv']);
    expect(sent[0]).toMatchObject({
      type: 'text/csv',
      size: Buffer.byteLength(COMPANIES_CSV, 'utf8'),
    });
    expect(Buffer.isBuffer(sent[0]?.buffer)).toBe(true);
    expect(sent[0]?.buffer.toString('utf8')).toBe(COMPANIES_CSV);
  });
});

describe('POST /api/admin/bitrix/upload — коды сервиса в статусы', () => {
  it.each([
    ['no_files', 400],
    ['too_many_files', 400],
    ['too_large', 413],
    ['invalid_mime', 415],
    ['file_unreadable', 422],
    ['storage', 502],
  ])('%s → %i, имя файла проброшено в тело', async (error, status) => {
    storeBitrixUploads.mockResolvedValue({ ok: false, error, file: 'плохой.csv' });
    const res = await POST(formReq([csvFile('плохой.csv')]));

    expect(res.status).toBe(status);
    expect(await body(res)).toEqual({ error, file: 'плохой.csv' });
  });

  it('без поля file в результате поля file нет и в теле ответа', async () => {
    storeBitrixUploads.mockResolvedValue({ ok: false, error: 'too_many_files' });
    const res = await POST(formReq([csvFile('companies.csv')]));

    expect(res.status).toBe(400);
    const json = await body(res);
    expect(json).toEqual({ error: 'too_many_files' });
    expect('file' in json).toBe(false);
  });

  it('неизвестный код → 400 (умолчание карты статусов)', async () => {
    storeBitrixUploads.mockResolvedValue({ ok: false, error: 'нежданчик' });
    const res = await POST(formReq([csvFile('companies.csv')]));

    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: 'нежданчик' });
  });

  it('успех → 200 с диагностикой файлов', async () => {
    const files = [
      {
        name: 'companies.csv',
        entity: 'company',
        candidate: 'company',
        rows: 5,
        unmatchedHeaders: [],
        missing: [],
        key: 'bitrix-import/uploads/uuid/1-companies.csv',
      },
    ];
    storeBitrixUploads.mockResolvedValue({ ok: true, files });

    const res = await POST(formReq([csvFile('companies.csv')]));

    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true, files });
  });
});
