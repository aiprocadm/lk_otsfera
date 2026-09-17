import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit, upload, add, notify, logWarn } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  upload: vi.fn(),
  add: vi.fn(),
  notify: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload }) }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add }) }));
vi.mock('@/lib/notifications/partnerMaterials', () => ({ notifyPartnerMaterialPublished: notify }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/services/admin/companyBranding', () => ({
  guardCompany: (s: SessionPayload, c: string) =>
    s.role === 'admin' || (s.role === 'leader' && s.companyId === c)
      ? null
      : { ok: false, error: 'forbidden' },
}));

import {
  createMaterial,
  listHubMaterials,
  publishMaterial,
  replaceMaterialFile,
  unpublishMaterial,
  updateMaterial,
} from '@/lib/services/partnerMaterials/hub';

/** Материалы для партнёров — сторона издателя (`У-237`, `Р-Э6-3`). */

const ADMIN = { sub: 'a1', role: 'admin', companyId: null } as unknown as SessionPayload;
const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;

const PDF = Buffer.from('%PDF-1.4 test');
const pdf = { name: 'прайс.pdf', mimeType: 'application/pdf', size: PDF.length, buffer: PDF };

function db(over: Record<string, unknown> = {}) {
  const tx = {
    partnerMaterialFile: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: 'f2' })),
    },
    partnerMaterial: { update: vi.fn(async () => ({})) },
  };
  const prisma = {
    partnerMaterial: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'm1', files: [{ id: 'f1' }] })),
      update: vi.fn(async () => ({})),
    },
    company: { findUnique: vi.fn(async () => ({ id: 'c1' })) },
    auditLog: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    ...over,
  };
  return { prisma: prisma as unknown as PrismaClient, raw: prisma as any, tx };
}

function material(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    companyId: 'c1',
    title: 'Прайс',
    isActive: true,
    publishedAt: null,
    externalUrl: null,
    files: [{ id: 'f1', path: 'company/c1/partner-materials/x.pdf', scanStatus: 'clean' }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue(undefined);
  add.mockResolvedValue(undefined);
  notify.mockResolvedValue({ recipientsNotified: 1 });
});

describe('listHubMaterials', () => {
  it('менеджеру и чужому руководителю — forbidden; пусто — без похода в аудит', async () => {
    const { prisma, raw } = db();
    expect(await listHubMaterials(prisma, MANAGER, 'c1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await listHubMaterials(prisma, LEADER, 'c2')).toEqual({ ok: false, error: 'forbidden' });
    expect(await listHubMaterials(prisma, LEADER, 'c1')).toEqual({ ok: true, rows: [] });
    expect(raw.auditLog.groupBy).not.toHaveBeenCalled();
  });

  it('строки с действующим файлом, счётчиком и последними скачиваниями', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findMany.mockResolvedValue([
      {
        id: 'm1',
        companyId: 'c1',
        title: 'Прайс',
        description: null,
        category: 'price_list',
        externalUrl: null,
        isActive: true,
        publishedAt: new Date('2026-09-10'),
        sortOrder: 0,
        updatedAt: new Date('2026-09-11'),
        company: { name: 'УЦ' },
        updatedBy: { name: 'Анна' },
        files: [
          {
            id: 'f1',
            fileName: 'p.pdf',
            mimeType: 'application/pdf',
            size: 10,
            scanStatus: 'clean',
            scanReason: null,
          },
        ],
      },
      {
        id: 'm2',
        companyId: 'c1',
        title: 'Ссылка',
        description: 'd',
        category: 'other',
        externalUrl: 'https://x',
        isActive: true,
        publishedAt: null,
        sortOrder: 1,
        updatedAt: new Date('2026-09-12'),
        company: { name: 'УЦ' },
        updatedBy: { name: 'Борис' },
        files: [],
      },
    ]);
    raw.auditLog.groupBy.mockResolvedValue([{ entityId: 'm1', _count: { _all: 12 } }]);
    raw.auditLog.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        entityId: 'm1',
        createdAt: new Date(2026, 8, 17, 10, i),
        user: { name: `П${i}` },
      }))
    );
    const r = await listHubMaterials(prisma, ADMIN, 'c1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.rows[0]).toMatchObject({
      id: 'm1',
      companyName: 'УЦ',
      updatedByName: 'Анна',
      file: { fileName: 'p.pdf', scanStatus: 'clean' },
      downloadsCount: 12,
    });
    // Показываем не больше десяти последних — счётчик хранит правду.
    expect(r.rows[0]!.downloads).toHaveLength(10);
    expect(r.rows[1]).toMatchObject({ id: 'm2', file: null, downloadsCount: 0, downloads: [] });
    expect(raw.partnerMaterial.findMany.mock.calls[0][0].where).toEqual({ companyId: 'c1' });
  });
});

describe('createMaterial', () => {
  const input = { title: 'Прайс', description: 'на осень', category: 'price_list' as const };

  it('граница компании и проверки формы', async () => {
    const { prisma, raw } = db();
    expect(await createMaterial(prisma, LEADER, 'c2', input, pdf)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const empty = await createMaterial(prisma, ADMIN, 'c1', { ...input, title: '  ' }, pdf);
    expect(empty).toMatchObject({ ok: false, error: 'validation' });
    const neither = await createMaterial(prisma, ADMIN, 'c1', input, null);
    expect(neither).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['Приложите файл или укажите ссылку.'],
    });
    const both = await createMaterial(
      prisma,
      ADMIN,
      'c1',
      { ...input, externalUrl: 'https://x' },
      pdf
    );
    expect(both).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['Либо файл, либо ссылка — не оба сразу.'],
    });
    const badUrl = await createMaterial(
      prisma,
      ADMIN,
      'c1',
      { ...input, externalUrl: 'ftp://x' },
      null
    );
    expect(badUrl).toMatchObject({ ok: false, error: 'validation' });
    const longTitle = await createMaterial(
      prisma,
      ADMIN,
      'c1',
      { ...input, title: 'x'.repeat(201) },
      pdf
    );
    expect(longTitle).toMatchObject({ ok: false, error: 'validation' });
    const longDesc = await createMaterial(
      prisma,
      ADMIN,
      'c1',
      { ...input, description: 'x'.repeat(2001) },
      pdf
    );
    expect(longDesc).toMatchObject({ ok: false, error: 'validation' });
    expect(raw.partnerMaterial.create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('компании нет — not_found; плохой файл и сбой хранилища — свои коды', async () => {
    const { prisma, raw } = db();
    raw.company.findUnique.mockResolvedValueOnce(null);
    expect(await createMaterial(prisma, ADMIN, 'c1', input, pdf)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      await createMaterial(prisma, ADMIN, 'c1', input, { ...pdf, mimeType: 'application/zip' })
    ).toEqual({
      ok: false,
      error: 'invalid_mime',
    });
    upload.mockRejectedValueOnce(new Error('s3 down'));
    expect(await createMaterial(prisma, ADMIN, 'c1', input, pdf)).toEqual({
      ok: false,
      error: 'storage',
    });
    expect(raw.partnerMaterial.create).not.toHaveBeenCalled();
  });

  it('с файлом: загрузка, черновик с версией файла, антивирус, аудит', async () => {
    const { prisma, raw } = db();
    const r = await createMaterial(prisma, LEADER, 'c1', input, pdf);
    expect(r).toEqual({ ok: true, id: 'm1' });
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^company\/c1\/partner-materials\//),
      PDF,
      { contentType: 'application/pdf' }
    );
    const data = raw.partnerMaterial.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      companyId: 'c1',
      title: 'Прайс',
      description: 'на осень',
      category: 'price_list',
      externalUrl: null,
      updatedById: 'l1',
    });
    expect(data.files.create).toMatchObject({
      fileName: 'прайс.pdf',
      mimeType: 'application/pdf',
      size: PDF.length,
      uploadedById: 'l1',
    });
    expect(data.publishedAt).toBeUndefined();
    expect(add).toHaveBeenCalledWith('scan', { kind: 'partner_material', id: 'f1' });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'partner_material_created', entityId: 'm1', userId: 'l1' })
    );
  });

  it('со ссылкой: без файла и без антивируса; сбой очереди не роняет создание', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.create.mockResolvedValue({ id: 'm2', files: [] });
    const r = await createMaterial(
      prisma,
      ADMIN,
      'c1',
      { ...input, description: '', externalUrl: ' https://x.ru/p ' },
      null
    );
    expect(r).toEqual({ ok: true, id: 'm2' });
    const data = raw.partnerMaterial.create.mock.calls[0][0].data;
    expect(data.externalUrl).toBe('https://x.ru/p');
    expect(data.description).toBeNull();
    expect(data.files).toBeUndefined();
    expect(add).not.toHaveBeenCalled();

    raw.partnerMaterial.create.mockResolvedValue({ id: 'm3', files: [{ id: 'f9' }] });
    add.mockRejectedValueOnce(new Error('redis down'));
    expect(await createMaterial(prisma, ADMIN, 'c1', input, pdf)).toEqual({ ok: true, id: 'm3' });
    expect(logWarn).toHaveBeenCalled();
  });
});

describe('updateMaterial', () => {
  const input = { title: 'Новый', category: 'template' as const };

  it('not_found, forbidden, правила «файл или ссылка»', async () => {
    const { prisma, raw } = db();
    expect(await updateMaterial(prisma, ADMIN, 'zz', input)).toEqual({
      ok: false,
      error: 'not_found',
    });
    raw.partnerMaterial.findUnique.mockResolvedValue(material());
    expect(await updateMaterial(prisma, LEADER, 'm1', input)).toEqual({ ok: true });
    expect(
      await updateMaterial(prisma, { ...LEADER, companyId: 'c2' } as SessionPayload, 'm1', input)
    ).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(
      await updateMaterial(prisma, ADMIN, 'm1', { ...input, externalUrl: 'https://x' })
    ).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['У материала с файлом ссылки не бывает.'],
    });
    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ files: [], externalUrl: 'https://old' })
    );
    expect(await updateMaterial(prisma, ADMIN, 'm1', input)).toMatchObject({
      ok: false,
      error: 'validation',
      messages: ['У материала без файла ссылка обязательна.'],
    });
  });

  it('пишет поля, порядок только если задан, аудит с before/after', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(material());
    await updateMaterial(prisma, ADMIN, 'm1', { ...input, description: '  ', sortOrder: 5 });
    expect(raw.partnerMaterial.update.mock.calls[0][0]).toEqual({
      where: { id: 'm1' },
      data: {
        title: 'Новый',
        description: null,
        category: 'template',
        externalUrl: null,
        sortOrder: 5,
        updatedById: 'a1',
      },
    });
    await updateMaterial(prisma, ADMIN, 'm1', input);
    expect(raw.partnerMaterial.update.mock.calls[1][0].data).not.toHaveProperty('sortOrder');
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'partner_material_updated',
        before: { title: 'Прайс' },
        after: expect.objectContaining({ title: 'Новый' }),
      })
    );
  });
});

describe('replaceMaterialFile', () => {
  it('у материала-ссылки файла нет; not_found; плохой файл', async () => {
    const { prisma, raw } = db();
    expect(await replaceMaterialFile(prisma, ADMIN, 'zz', pdf)).toEqual({
      ok: false,
      error: 'not_found',
    });
    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ files: [], externalUrl: 'https://x' })
    );
    expect(await replaceMaterialFile(prisma, ADMIN, 'm1', pdf)).toMatchObject({
      ok: false,
      error: 'validation',
    });
    raw.partnerMaterial.findUnique.mockResolvedValue(material());
    expect(await replaceMaterialFile(prisma, ADMIN, 'm1', { ...pdf, size: 10 ** 10 })).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it('новая версия в транзакции: прежняя скрыта, новая на проверке, аудит', async () => {
    const { prisma, raw, tx } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(material());
    const r = await replaceMaterialFile(prisma, LEADER, 'm1', pdf);
    expect(r).toEqual({ ok: true, fileId: 'f2' });
    expect(tx.partnerMaterialFile.updateMany).toHaveBeenCalledWith({
      where: { materialId: 'm1', supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    });
    expect((tx.partnerMaterialFile.create as any).mock.calls[0][0].data).toMatchObject({
      materialId: 'm1',
      fileName: 'прайс.pdf',
      uploadedById: 'l1',
    });
    expect(add).toHaveBeenCalledWith('scan', { kind: 'partner_material', id: 'f2' });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'partner_material_file_replaced',
        before: { fileId: 'f1' },
        after: expect.objectContaining({ fileId: 'f2' }),
      })
    );
  });
});

describe('publishMaterial', () => {
  it('файл ещё проверяется или его нет — not_ready; заражён — infected', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ files: [{ id: 'f1', path: 'p', scanStatus: 'pending' }] })
    );
    expect(await publishMaterial(prisma, ADMIN, 'm1')).toEqual({ ok: false, error: 'not_ready' });
    raw.partnerMaterial.findUnique.mockResolvedValue(material({ files: [] }));
    expect(await publishMaterial(prisma, ADMIN, 'm1')).toEqual({ ok: false, error: 'not_ready' });
    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ files: [{ id: 'f1', path: 'p', scanStatus: 'infected' }] })
    );
    expect(await publishMaterial(prisma, ADMIN, 'm1')).toEqual({ ok: false, error: 'infected' });
    expect(raw.partnerMaterial.update).not.toHaveBeenCalled();
    raw.partnerMaterial.findUnique.mockResolvedValue(null);
    expect(await publishMaterial(prisma, ADMIN, 'zz')).toEqual({ ok: false, error: 'not_found' });
  });

  it('первая публикация: дата, аудит, уведомление; повторная — без даты и без рассылки', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(material());
    expect(await publishMaterial(prisma, LEADER, 'm1')).toEqual({ ok: true });
    expect(raw.partnerMaterial.update.mock.calls[0][0].data).toEqual({
      isActive: true,
      publishedAt: expect.any(Date),
      updatedById: 'l1',
    });
    expect(notify).toHaveBeenCalledWith(prisma, 'm1');
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'partner_material_published',
        after: { title: 'Прайс', firstPublication: true },
      })
    );

    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ isActive: false, publishedAt: new Date('2026-09-01') })
    );
    await publishMaterial(prisma, LEADER, 'm1');
    expect(raw.partnerMaterial.update.mock.calls[1][0].data).toEqual({
      isActive: true,
      updatedById: 'l1',
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('материал-ссылка публикуется без файла; сбой рассылки не откатывает публикацию', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(
      material({ files: [], externalUrl: 'https://x' })
    );
    notify.mockRejectedValueOnce(new Error('smtp down'));
    expect(await publishMaterial(prisma, ADMIN, 'm1')).toEqual({ ok: true });
    expect(logWarn).toHaveBeenCalledWith(
      '[partnerMaterials] publish notify failed',
      expect.objectContaining({ materialId: 'm1' })
    );
  });
});

describe('unpublishMaterial', () => {
  it('снимает с публикации, пишет аудит; чужое — forbidden', async () => {
    const { prisma, raw } = db();
    raw.partnerMaterial.findUnique.mockResolvedValue(material({ publishedAt: new Date() }));
    expect(await unpublishMaterial(prisma, LEADER, 'm1')).toEqual({ ok: true });
    expect(raw.partnerMaterial.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { isActive: false, updatedById: 'l1' },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'partner_material_unpublished' })
    );
    expect(await unpublishMaterial(prisma, MANAGER, 'm1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
