/**
 * Этап 9 (ФТ-11.1, PR-1) — вопрос из кабинета: гейт ролей, валидация,
 * вложение (лимит/MIME/magic-bytes), клеймы отправителя, статус unresolved,
 * короткий код, аудит.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { ingestMock, uploadMock, recordAuditMock, validateMagicBytesMock } = vi.hoisted(() => ({
  ingestMock: vi.fn(),
  uploadMock: vi.fn(),
  recordAuditMock: vi.fn(),
  validateMagicBytesMock: vi.fn()
}));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage: ingestMock }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadMock }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/storage/mimeValidator', () => ({ validateMagicBytes: validateMagicBytesMock }));
vi.mock('@/lib/logging', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { submitCabinetQuestion, questionCode } from '@/lib/services/inbound/cabinetQuestion';

const orgSession = (over: Record<string, unknown> = {}): SessionPayload =>
  ({
    sub: 'u1',
    role: 'organization',
    email: 'client@x.ru',
    name: 'Иван',
    organizationId: 'org-1',
    organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: true }],
    ...over
  }) as unknown as SessionPayload;
const partnerSession = (): SessionPayload =>
  ({ sub: 'p1', role: 'partner', email: 'p@x.ru', name: 'Пётр', partnerId: 'pt-1' }) as unknown as SessionPayload;
const managerSession = (): SessionPayload => ({ sub: 'm1', role: 'manager' }) as unknown as SessionPayload;

function fakePrisma(companyId: string | null = 'co-A') {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(companyId ? { companyId } : null) }
  } as unknown as PrismaClient;
}

const VALID = { subject: 'Не открывается документ', body: 'Помогите, пожалуйста' };
const pdf = { name: 'файл.pdf', type: 'application/pdf', size: 1000, buffer: Buffer.from('%PDF-1.4') };

beforeEach(() => {
  vi.clearAllMocks();
  ingestMock.mockResolvedValue({ ok: true, id: 'clx123abc3f7a2c', deduped: false });
  uploadMock.mockResolvedValue(undefined);
  validateMagicBytesMock.mockReturnValue({ ok: true, mime: 'application/pdf' });
});

describe('questionCode', () => {
  it('короткий код из последних 6 символов id в верхнем регистре', () => {
    expect(questionCode('clx123abc3f7a2c')).toBe('ОБР-3F7A2C');
  });
});

describe('submitCabinetQuestion', () => {
  it('сотрудник → forbidden (кабинет-вопрос только клиентским ролям)', async () => {
    expect(await submitCabinetQuestion(fakePrisma(), managerSession(), VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('организация: клеймы отправителя, unresolved-статус, код обращения, аудит', async () => {
    const prisma = fakePrisma('co-A');
    const res = await submitCabinetQuestion(prisma, orgSession(), VALID);
    expect(res).toEqual({ ok: true, id: 'clx123abc3f7a2c', code: 'ОБР-3F7A2C' });

    const dto = ingestMock.mock.calls[0]![1];
    expect(dto).toMatchObject({
      channel: 'cabinet',
      senderRef: 'client@x.ru',
      senderDisplay: 'Иван',
      subject: 'Не открывается документ',
      sender: { userId: 'u1', organizationId: 'org-1', companyId: 'co-A' }
    });
    expect(dto.externalId).toMatch(/^cabinet:/);
    expect(dto.attachmentPath).toBeUndefined();
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'cabinet_question_submitted', entity: 'inbound_message' })
    );
  });

  it('партнёр: без организации и компании (общая очередь)', async () => {
    await submitCabinetQuestion(fakePrisma(), partnerSession(), VALID);
    expect(ingestMock.mock.calls[0]![1].sender).toEqual({ userId: 'p1', organizationId: null, companyId: null });
  });

  it('валидация: пустая тема/текст и превышение длины — списком, без записи', async () => {
    const empty = await submitCabinetQuestion(fakePrisma(), orgSession(), { subject: '  ', body: '' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.messages).toEqual(['Укажите тему обращения', 'Опишите вопрос']);

    const long = await submitCabinetQuestion(fakePrisma(), orgSession(), { subject: 'x'.repeat(201), body: 'y'.repeat(5001) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.messages).toHaveLength(2);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it('вложение: успех кладёт файл в support/{userId}/… и передаёт метаданные', async () => {
    await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: pdf });
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^support\/u1\/.+файл\.pdf$/),
      pdf.buffer,
      { contentType: 'application/pdf' }
    );
    const dto = ingestMock.mock.calls[0]![1];
    expect(dto.attachmentName).toBe('файл.pdf');
    expect(dto.attachmentMime).toBe('application/pdf');
  });

  it('вложение: размер, MIME и magic-bytes отбиваются до загрузки', async () => {
    const big = { ...pdf, size: 999_000_000 };
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: big })).toEqual({ ok: false, error: 'too_large' });

    const exe = { ...pdf, type: 'application/x-msdownload' };
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: exe })).toEqual({ ok: false, error: 'invalid_mime' });

    validateMagicBytesMock.mockReturnValue({ ok: false, reason: 'mime_mismatch' });
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: pdf })).toEqual({ ok: false, error: 'invalid_mime' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('сбой хранилища → storage; сбой ingest → storage', async () => {
    uploadMock.mockRejectedValue(new Error('s3 down'));
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: pdf })).toEqual({ ok: false, error: 'storage' });

    uploadMock.mockResolvedValue(undefined);
    ingestMock.mockResolvedValue({ ok: false, error: 'storage' });
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), VALID)).toEqual({ ok: false, error: 'storage' });
  });

  it('организация без активного членства: берётся organizationId сессии', async () => {
    await submitCabinetQuestion(fakePrisma(), orgSession({ organizationMemberships: [] }), VALID);
    expect(ingestMock.mock.calls[0]![1].sender.organizationId).toBe('org-1');
  });
});
