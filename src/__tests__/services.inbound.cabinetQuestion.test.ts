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
  validateMagicBytesMock: vi.fn(),
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
    ...over,
  }) as unknown as SessionPayload;
const partnerSession = (): SessionPayload =>
  ({
    sub: 'p1',
    role: 'partner',
    email: 'p@x.ru',
    name: 'Пётр',
    partnerId: 'pt-1',
  }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager' }) as unknown as SessionPayload;

function fakePrisma(companyId: string | null = 'co-A') {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(companyId ? { companyId } : null) },
  } as unknown as PrismaClient;
}

const VALID = { subject: 'Не открывается документ', body: 'Помогите, пожалуйста' };
const pdf = {
  name: 'файл.pdf',
  type: 'application/pdf',
  size: 1000,
  buffer: Buffer.from('%PDF-1.4'),
};

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
    expect(await submitCabinetQuestion(fakePrisma(), managerSession(), VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
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
      sender: { userId: 'u1', organizationId: 'org-1', companyId: 'co-A' },
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
    expect(ingestMock.mock.calls[0]![1].sender).toEqual({
      userId: 'p1',
      organizationId: null,
      companyId: null,
    });
  });

  it('валидация: пустая тема/текст и превышение длины — списком, без записи', async () => {
    const empty = await submitCabinetQuestion(fakePrisma(), orgSession(), {
      subject: '  ',
      body: '',
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.messages).toEqual(['Укажите тему обращения', 'Опишите вопрос']);

    const long = await submitCabinetQuestion(fakePrisma(), orgSession(), {
      subject: 'x'.repeat(201),
      body: 'y'.repeat(5001),
    });
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
    expect(
      await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: big })
    ).toEqual({ ok: false, error: 'too_large' });

    const exe = { ...pdf, type: 'application/x-msdownload' };
    expect(
      await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: exe })
    ).toEqual({ ok: false, error: 'invalid_mime' });

    validateMagicBytesMock.mockReturnValue({ ok: false, reason: 'mime_mismatch' });
    expect(
      await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: pdf })
    ).toEqual({ ok: false, error: 'invalid_mime' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('сбой хранилища → storage; сбой ingest → storage', async () => {
    uploadMock.mockRejectedValue(new Error('s3 down'));
    expect(
      await submitCabinetQuestion(fakePrisma(), orgSession(), { ...VALID, file: pdf })
    ).toEqual({ ok: false, error: 'storage' });

    uploadMock.mockResolvedValue(undefined);
    ingestMock.mockResolvedValue({ ok: false, error: 'storage' });
    expect(await submitCabinetQuestion(fakePrisma(), orgSession(), VALID)).toEqual({
      ok: false,
      error: 'storage',
    });
  });

  it('организация без активного членства: берётся organizationId сессии', async () => {
    await submitCabinetQuestion(fakePrisma(), orgSession({ organizationMemberships: [] }), VALID);
    expect(ingestMock.mock.calls[0]![1].sender.organizationId).toBe('org-1');
  });

  it('активное членство в другой организации: берётся оно, а не поле сессии', async () => {
    // Клиент переключился между своими организациями — обращение должно уйти в
    // ту, где он реально активен, иначе менеджер увидит его не в той очереди.
    await submitCabinetQuestion(
      fakePrisma(),
      orgSession({
        organizationId: 'org-stale',
        organizationMemberships: [{ organizationId: 'org-2', roleInOrg: 'admin', isActive: true }],
      }),
      VALID
    );
    expect(ingestMock.mock.calls[0]![1].sender.organizationId).toBe('org-2');
  });

  it('организация исчезла из базы → компания не проставляется, обращение всё равно принимается', async () => {
    await submitCabinetQuestion(fakePrisma(null), orgSession(), VALID);
    expect(ingestMock.mock.calls[0]![1].sender.companyId).toBeNull();
  });

  it('поля темы и текста отсутствуют вовсе → валидация, а не падение', async () => {
    // Экшен зовётся из формы: поле может не прийти. Ожидаем список причин, а не
    // TypeError на `.trim()` у undefined.
    const res = await submitCabinetQuestion(fakePrisma(), orgSession(), {} as never);
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    if (res.ok) return;
    expect(res.messages).toEqual(['Укажите тему обращения', 'Опишите вопрос']);
  });

  it('отправитель без почты и без имени: подставляются id и пустое имя', async () => {
    // У сессии может не быть ни почты, ни имени (импортированный аккаунт).
    // Обращение всё равно должно быть привязано к человеку — по его id.
    await submitCabinetQuestion(
      fakePrisma(),
      orgSession({ email: undefined, name: undefined }),
      VALID
    );
    const sender = ingestMock.mock.calls[0]![1];
    expect(sender.senderRef).toBe('u1');
    expect(sender.senderDisplay).toBeNull();
  });

  it('пустое имя файла (одни разделители пути) заменяется на «file»', async () => {
    // Хранилищу нужно непустое имя. Если после отсечения каталогов не осталось
    // ничего, кладём нейтральное «file» вместо пустой строки.
    await submitCabinetQuestion(fakePrisma(), orgSession(), {
      ...VALID,
      file: { ...pdf, name: 'C:\\Users\\Иван\\' },
    });
    expect(ingestMock.mock.calls[0]![1].attachmentName).toBe('file');
  });

  it('организация без списка членств вообще и без organizationId → общая очередь', async () => {
    // Клиентская сессия может прийти без поля членств (старый токен). Обращение
    // тогда падает в общую очередь, а не роняет отправку.
    await submitCabinetQuestion(
      fakePrisma(),
      orgSession({ organizationMemberships: undefined, organizationId: undefined }),
      VALID
    );
    const sender = ingestMock.mock.calls[0]![1];
    expect(sender.sender.organizationId).toBeNull();
    expect(sender.sender.companyId).toBeNull();
  });

  it('имя файла с путём и опасными символами обрезается до безопасного', async () => {
    // Браузер (и особенно старый клиент) может прислать полный путь. В хранилище
    // должно уехать только имя, без каталогов и служебных символов.
    await submitCabinetQuestion(fakePrisma(), orgSession(), {
      ...VALID,
      file: { ...pdf, name: 'C:\\Users\\Иван\\Мои документы\\счёт №1*?.pdf' },
    });
    const passed = ingestMock.mock.calls[0]![1].attachmentName as string;
    expect(passed).not.toContain('\\');
    expect(passed).not.toContain('*');
    expect(passed).toContain('.pdf');
  });
});
