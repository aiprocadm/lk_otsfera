import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/documents/zip` (`У-252`) — тонкий роут: сессия → сервис → файл или
 * понятный отказ.
 *
 * Главное здесь — отказы. Молча срезанный архив человек примет за полный,
 * поэтому предел отвечает 413 с числами и подсказкой, что сделать, а не 200 с
 * половиной файлов.
 */
const { getSession, buildDocumentsZip } = vi.hoisted(() => ({
  getSession: vi.fn(),
  buildDocumentsZip: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/documents/zip', async () => {
  const real = await vi.importActual<typeof import('@/lib/services/documents/zip')>(
    '@/lib/services/documents/zip'
  );
  return { ...real, buildDocumentsZip };
});

import { GET } from '@/app/api/documents/zip/route';

const req = (qs: string) => new Request(`https://app.local/api/documents/zip${qs}`);

const NOTHING_SKIPPED = { noAccess: 0, pending: 0, infected: 0, unavailable: 0 };

describe('GET /api/documents/zip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ sub: 'u1', role: 'manager' });
  });

  it('без сессии — 401 и сервис не зовём', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req('?ids=a'));
    expect(res.status).toBe(401);
    expect(buildDocumentsZip).not.toHaveBeenCalled();
  });

  it('список идентификаторов разбирается до сервиса', async () => {
    buildDocumentsZip.mockResolvedValue({ ok: false, error: 'no_ids' });
    await GET(req('?ids=b,%20a%20,b'));
    expect(buildDocumentsZip.mock.calls[0]![2]).toEqual(['b', 'a']);
  });

  it('ничего не выбрано — 400 с человеческой строкой', async () => {
    buildDocumentsZip.mockResolvedValue({ ok: false, error: 'no_ids' });
    const res = await GET(req(''));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'Не выбрано ни одного документа.' });
  });

  it('слишком много файлов — 413 с числами и подсказкой', async () => {
    buildDocumentsZip.mockResolvedValue({
      ok: false,
      error: 'too_many_files',
      requested: 80,
      limit: 50,
    });
    const res = await GET(req('?ids=a'));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('80');
    expect(body.message).toContain('50');
    expect(body.message).toContain('Снимите лишние галочки');
  });

  it('слишком большой объём — 413 в мегабайтах, а не в байтах', async () => {
    buildDocumentsZip.mockResolvedValue({
      ok: false,
      error: 'too_large',
      bytes: 600 * 1024 * 1024,
      limit: 500 * 1024 * 1024,
    });
    const res = await GET(req('?ids=a'));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('600 МБ');
    expect(body.message).toContain('500 МБ');
  });

  it('ни один документ не подошёл — 404 и объяснение почему', async () => {
    buildDocumentsZip.mockResolvedValue({
      ok: false,
      error: 'empty',
      skipped: { noAccess: 2, pending: 1, infected: 0, unavailable: 0 },
    });
    const res = await GET(req('?ids=a,b,c'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('не включено: 2');
    expect(body.message).toContain('ожидает проверки: 1');
  });

  it('успех: архив, русское имя файла и числа пропусков в заголовке', async () => {
    buildDocumentsZip.mockResolvedValue({
      ok: true,
      zip: Buffer.from('zip'),
      fileName: 'Документы 2026-09-18.zip',
      included: 3,
      skipped: { ...NOTHING_SKIPPED, noAccess: 1 },
    });
    const res = await GET(req('?ids=a,b,c,d'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    // Русское имя уходит в кодированном виде: иначе часть браузеров сохранит
    // файл под именем из знаков вопроса.
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(res.headers.get('content-disposition')).toContain('%D0%94');
    expect(res.headers.get('x-documents-count')).toBe('3');
    expect(JSON.parse(res.headers.get('x-documents-skipped') ?? '{}')).toMatchObject({
      noAccess: 1,
    });
  });
});
