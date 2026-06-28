import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { GenerateCommissionXlsxPayload } from '@/lib/jobs/types';

const { uploadMock, renderXlsxMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  renderXlsxMock: vi.fn()
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: uploadMock,
    download: vi.fn(),
    createSignedUrl: vi.fn(),
    remove: vi.fn()
  })
}));
vi.mock('@/lib/services/commission/xlsx', () => ({
  renderStatementXlsx: renderXlsxMock
}));

import { generateCommissionXlsxProcessor } from '@/worker/processors/generate-commission-xlsx';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let prisma: PrismaClient;
let partnerId: string;
let statementId: string;

function job(id: string): Job<GenerateCommissionXlsxPayload> {
  return { id: 'test-xlsx-' + Date.now(), data: { statementId: id } } as Job<GenerateCommissionXlsxPayload>;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `XlsxProcPartner-${Date.now()}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const stmt = await prisma.commissionStatement.create({
    data: { partnerId, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') }
  });
  statementId = stmt.id;
});

afterAll(async () => {
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  uploadMock.mockReset();
  renderXlsxMock.mockReset();
  renderXlsxMock.mockResolvedValue(Buffer.from('PK fake-xlsx'));
  uploadMock.mockResolvedValue(undefined);
});

describe('generateCommissionXlsxProcessor', () => {
  it('renders, uploads to the partner path, and persists xlsxPath', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { xlsxPath: null } });

    const result = await generateCommissionXlsxProcessor(job(statementId), prisma);

    const expectedPath = `partners/${partnerId}/commission/${statementId}.xlsx`;
    expect(result).toEqual({ statementId, path: expectedPath });

    expect(renderXlsxMock).toHaveBeenCalledTimes(1);
    const renderArg = renderXlsxMock.mock.calls[0][0];
    expect(renderArg.statement.id).toBe(statementId);
    expect(renderArg.partner).toEqual({ name: expect.any(String) });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [uploadPath, uploadBuf, uploadOpts] = uploadMock.mock.calls[0];
    expect(uploadPath).toBe(expectedPath);
    expect(Buffer.isBuffer(uploadBuf)).toBe(true);
    expect(uploadOpts).toMatchObject({ contentType: XLSX_CONTENT_TYPE });

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { xlsxPath: true }
    });
    expect(reread?.xlsxPath).toBe(expectedPath);
  });

  it('throws NOT_FOUND when the statement does not exist', async () => {
    await expect(generateCommissionXlsxProcessor(job('does-not-exist'), prisma)).rejects.toThrow(/NOT_FOUND/);
    expect(renderXlsxMock).not.toHaveBeenCalled();
  });

  it('propagates the storage error and does not persist xlsxPath when upload throws', async () => {
    await prisma.commissionStatement.update({ where: { id: statementId }, data: { xlsxPath: null } });
    uploadMock.mockRejectedValue(new Error('STORAGE_UPLOAD: bucket exploded'));

    await expect(generateCommissionXlsxProcessor(job(statementId), prisma)).rejects.toThrow(/bucket exploded/);

    const reread = await prisma.commissionStatement.findUnique({
      where: { id: statementId },
      select: { xlsxPath: true }
    });
    expect(reread?.xlsxPath).toBeNull();
  });
});
