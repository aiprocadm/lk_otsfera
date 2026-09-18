/**
 * `У-252` — сборка архива из выбранных документов.
 *
 * Проверяется поведение, а не вызовы: что попало в архив, что не попало и
 * почему, и в каком порядке система отказывается. Порядок важен: предел по
 * числу файлов обязан сработать ДО обращения к базе и хранилищу, иначе ради
 * отказа скачается полгигабайта.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, downloadMock, auditMock, zipFile, generateAsync } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  downloadMock: vi.fn(),
  auditMock: vi.fn(),
  zipFile: vi.fn(),
  generateAsync: vi.fn(),
}));

vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: auditMock }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ download: downloadMock }),
}));
vi.mock('jszip', () => ({
  default: class {
    file = zipFile;
    generateAsync = generateAsync;
  },
}));

import {
  buildDocumentsZip,
  parseDocumentIds,
  ZIP_MAX_FILES,
  ZIP_MAX_BYTES,
} from '@/lib/services/documents/zip';

const session = { sub: 'u1', role: 'manager', companyId: 'co1' } as SessionPayload;

function doc(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    name: 'schet.pdf',
    path: 'orders/o1/schet.pdf',
    size: 1024,
    scanStatus: 'clean',
    type: 'invoice',
    number: 'С-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    status: 'issued',
    orderId: 'o1',
    companyId: null,
    counterpartyType: 'organization',
    counterpartyId: 'org1',
    order: { companyId: 'co1' },
    ...over,
  };
}

function db(rows: unknown[]) {
  return {
    document: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient;
}

describe('parseDocumentIds', () => {
  it('пустой параметр — пустой список', () => {
    expect(parseDocumentIds(null)).toEqual([]);
    expect(parseDocumentIds('')).toEqual([]);
    expect(parseDocumentIds(' , , ')).toEqual([]);
  });

  it('повторы схлопываются, порядок сохраняется', () => {
    expect(parseDocumentIds('b, a ,b,c')).toEqual(['b', 'a', 'c']);
  });
});

describe('buildDocumentsZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadDocument.mockResolvedValue(true);
    downloadMock.mockResolvedValue(Buffer.from('file'));
    generateAsync.mockResolvedValue(Buffer.from('zip'));
  });

  it('ничего не выбрано — отдельный ответ, а не пустой архив', async () => {
    const prisma = db([]);
    expect(await buildDocumentsZip(prisma, session, [])).toEqual({ ok: false, error: 'no_ids' });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('больше предела по числу — отказ ДО базы и хранилища', async () => {
    const prisma = db([]);
    const ids = Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => `d${i}`);
    const res = await buildDocumentsZip(prisma, session, ids);
    expect(res).toEqual({
      ok: false,
      error: 'too_many_files',
      requested: ZIP_MAX_FILES + 1,
      limit: ZIP_MAX_FILES,
    });
    expect(prisma.document.findMany, 'ради отказа сходили в базу').not.toHaveBeenCalled();
    expect(downloadMock, 'ради отказа скачали файлы').not.toHaveBeenCalled();
  });

  it('ровно предел — архив собирается', async () => {
    const rows = Array.from({ length: ZIP_MAX_FILES }, (_, i) => doc({ id: `d${i}`, size: 1 }));
    const res = await buildDocumentsZip(
      db(rows),
      session,
      rows.map((r) => r.id)
    );
    expect(res.ok).toBe(true);
    expect(res.ok && res.included).toBe(ZIP_MAX_FILES);
  });

  it('чужой документ молча пропускается и считается', async () => {
    canReadDocument.mockImplementation(async (_s: unknown, d: { id: string }) => d.id === 'd1');
    const res = await buildDocumentsZip(db([doc(), doc({ id: 'd2' })]), session, ['d1', 'd2']);
    expect(res.ok).toBe(true);
    expect(res.ok && res.skipped.noAccess).toBe(1);
    expect(res.ok && res.included).toBe(1);
  });

  it('несуществующий документ не отличается от чужого', async () => {
    const res = await buildDocumentsZip(db([doc()]), session, ['d1', 'нет-такого']);
    expect(res.ok && res.skipped.noAccess).toBe(1);
  });

  it('непроверенный и заражённый файлы считаются по-разному', async () => {
    const rows = [
      doc(),
      doc({ id: 'd2', scanStatus: 'pending' }),
      doc({ id: 'd3', scanStatus: 'infected' }),
    ];
    const res = await buildDocumentsZip(db(rows), session, ['d1', 'd2', 'd3']);
    expect(res.ok && res.skipped.pending).toBe(1);
    expect(res.ok && res.skipped.infected).toBe(1);
    expect(res.ok && res.included).toBe(1);
  });

  it('годных документов не осталось — ответ объясняет почему', async () => {
    const res = await buildDocumentsZip(db([doc({ scanStatus: 'infected' })]), session, ['d1']);
    expect(res).toMatchObject({ ok: false, error: 'empty' });
    expect(!res.ok && res.error === 'empty' && res.skipped.infected).toBe(1);
  });

  it('суммарный объём больше предела — отказ до скачивания', async () => {
    const rows = [doc({ size: ZIP_MAX_BYTES }), doc({ id: 'd2', size: 1 })];
    const res = await buildDocumentsZip(db(rows), session, ['d1', 'd2']);
    expect(res).toMatchObject({ ok: false, error: 'too_large', limit: ZIP_MAX_BYTES });
    expect(downloadMock, 'файлы скачали, хотя предел уже превышен').not.toHaveBeenCalled();
  });

  it('документ без известного размера не мешает собрать архив', async () => {
    // У строк старше этапа загрузок размера нет: отказать из-за неизвестного
    // размера хуже, чем изредка собрать архив чуть больше предела.
    const res = await buildDocumentsZip(db([doc({ size: null })]), session, ['d1']);
    expect(res.ok).toBe(true);
  });

  it('пропавший в хранилище файл не роняет весь архив', async () => {
    downloadMock.mockImplementation(async (path: string) => {
      if (path === 'нет') throw new Error('404');
      return Buffer.from('file');
    });
    const rows = [doc(), doc({ id: 'd2', path: 'нет' })];
    const res = await buildDocumentsZip(db(rows), session, ['d1', 'd2']);
    expect(res.ok).toBe(true);
    expect(res.ok && res.skipped.unavailable).toBe(1);
    expect(res.ok && res.included).toBe(1);
  });

  it('все файлы пропали — архива нет', async () => {
    downloadMock.mockRejectedValue(new Error('нет файла'));
    const res = await buildDocumentsZip(db([doc()]), session, ['d1']);
    expect(res).toMatchObject({ ok: false, error: 'empty' });
  });

  it('имена внутри архива собираются по правилу У-154 и не повторяются', async () => {
    const rows = [doc(), doc({ id: 'd2' })];
    await buildDocumentsZip(db(rows), session, ['d1', 'd2']);
    const names = zipFile.mock.calls.map((c) => c[0] as string);
    expect(names[0]).toBe('Счёт С-1 от 01.09.2026.pdf');
    expect(names[1]).toBe('Счёт С-1 от 01.09.2026 (2).pdf');
  });

  it('в журнал попадает перечень того, что реально уехало', async () => {
    const rows = [doc(), doc({ id: 'd2', scanStatus: 'pending' })];
    await buildDocumentsZip(db(rows), session, ['d1', 'd2']);
    const rec = auditMock.mock.calls[0]![1];
    expect(rec.action).toBe('documents_zip_downloaded');
    expect(rec.after).toMatchObject({ documentIds: ['d1'], requested: 2, included: 1 });
  });

  it('имя архива несёт дату — два скачивания подряд не путаются', async () => {
    const res = await buildDocumentsZip(
      db([doc()]),
      session,
      ['d1'],
      new Date('2026-09-18T12:00:00Z')
    );
    expect(res.ok && res.fileName).toBe('Документы 2026-09-18.zip');
  });
});
