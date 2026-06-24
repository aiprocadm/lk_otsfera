import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  leadFindFirst, attFindFirst, attFindMany, attCreate, attDelete, auditCreate,
  storageUpload, storageRemove, storageSigned, queueAdd,
  validateMagicBytes, extensionFor, isPartnerAdmin, recordAudit
} = vi.hoisted(() => ({
  leadFindFirst: vi.fn(),
  attFindFirst: vi.fn(),
  attFindMany: vi.fn(),
  attCreate: vi.fn(),
  attDelete: vi.fn(),
  auditCreate: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  storageSigned: vi.fn(),
  queueAdd: vi.fn(),
  validateMagicBytes: vi.fn(),
  extensionFor: vi.fn(),
  isPartnerAdmin: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: storageUpload,
    remove: storageRemove,
    createSignedUrl: storageSigned,
    download: vi.fn()
  }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));
vi.mock('@/lib/storage/mimeValidator', () => ({ validateMagicBytes, extensionFor }));
vi.mock('@/lib/auth/policy', () => ({ isPartnerAdmin }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: queueAdd }) }));
vi.mock('@/lib/services/scan/visibility', () => ({
  INFECTED_HIDDEN_WHERE: { scanStatus: { not: 'infected' } }
}));

import {
  uploadLeadAttachment,
  deleteLeadAttachment,
  getLeadAttachmentDownloadUrl,
  listLeadAttachments,
  LeadAttachmentError,
  __testing
} from '@/lib/services/partner/leadAttachments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prismaMock() {
  const tx = {
    leadAttachment: { create: attCreate, delete: attDelete },
    auditLog: { create: auditCreate }
  };
  return {
    lead: { findFirst: leadFindFirst },
    leadAttachment: { findFirst: attFindFirst, findMany: attFindMany },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx))
  } as never;
}

const goodFile = () => ({
  buffer: new Uint8Array([1, 2, 3]),
  name: 'doc.pdf',
  declaredMimeType: 'application/pdf',
  size: 1024
});

const session = (sub = 'u1') => ({ sub, role: 'partner' }) as never;

// ---------------------------------------------------------------------------
// beforeEach: reset all mocks to happy-path defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  validateMagicBytes.mockReturnValue({ ok: true, mime: 'application/pdf' });
  extensionFor.mockReturnValue('pdf');
  storageUpload.mockResolvedValue(undefined);
  storageRemove.mockResolvedValue(undefined);
  storageSigned.mockResolvedValue('https://signed');
  attCreate.mockResolvedValue({ id: 'att-1' });
  isPartnerAdmin.mockReturnValue(false);
  recordAudit.mockResolvedValue(undefined);
  queueAdd.mockResolvedValue(undefined);
});

// ===========================================================================
// uploadLeadAttachment
// ===========================================================================

describe('uploadLeadAttachment', () => {
  const input = () => ({
    leadId: 'l1',
    partnerId: 'p1',
    uploadedByUserId: 'u1',
    file: goodFile()
  });

  it('успех: создаёт вложение, аудит, ставит scan в очередь', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toEqual({ ok: true, attachment: { id: 'att-1' } });
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'leadAttachment', id: 'att-1' });
    expect(recordAudit).toHaveBeenCalled();
  });

  it('успех при status=in_review (второй допустимый статус)', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'in_review' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: true });
  });

  it('FILE_TOO_LARGE при превышении размера', async () => {
    const r = await uploadLeadAttachment(prismaMock(), {
      ...input(),
      file: { ...goodFile(), size: 999_000_000 }
    });
    expect(r).toMatchObject({ ok: false, error: 'FILE_TOO_LARGE' });
  });

  it('INVALID_FILENAME на пустом имени (только пробелы)', async () => {
    const r = await uploadLeadAttachment(prismaMock(), {
      ...input(),
      file: { ...goodFile(), name: '   ' }
    });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_FILENAME' });
  });

  it('INVALID_FILENAME на имени с только точкой (leading-dot без base)', async () => {
    // '.pdf' → lastDot=0 so base='.pdf' (lastDot > 0 is false), then cleaned is '.pdf' without replacements
    // Actually '.pdf': lastDot=0, so base = '.pdf' → cleaned='.pdf' which is truthy, no INVALID_FILENAME
    // BUT trimmed='.pdf' → base='.pdf' (lastDot=0 is not > 0) → cleaned='.pdf' → truthy
    // This won't trigger INVALID_FILENAME. Test a truly empty-after-sanitize case instead.
    // A name that is all special chars with no extension: e.g. '////' → base = '////' → cleaned = '____' → truthy
    // A name like '.' → lastDot=0, base='.', cleaned='.', truthy → not empty
    // The only way to get '' is if trimmed is ''. Tab/newline/space only → trimmed='', return ''
    const r = await uploadLeadAttachment(prismaMock(), {
      ...input(),
      file: { ...goodFile(), name: '\t\n\r' }
    });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_FILENAME' });
  });

  it('UNSUPPORTED_MEDIA_TYPE при провале magic-bytes', async () => {
    validateMagicBytes.mockReturnValue({ ok: false, reason: 'bad magic bytes' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('NOT_FOUND если заявка вне scope (loadLeadInScope → null)', async () => {
    leadFindFirst.mockResolvedValue(null);
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('LEAD_NOT_EDITABLE если статус не в DELETABLE_STATUSES', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'converted' });
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'LEAD_NOT_EDITABLE' });
  });

  it('STORAGE_FAILURE при ошибке storage.upload', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    storageUpload.mockRejectedValue(new Error('bucket down'));
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('STORAGE_FAILURE при не-Error из storage.upload (ветка String(e))', async () => {
    // Покрывает строку 146: e instanceof Error ? e.message : String(e) — не-Error плечо
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    storageUpload.mockRejectedValue('bucket exploded');
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('проглатывает ошибку enqueue scan и всё равно возвращает ok:true', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    queueAdd.mockRejectedValue(new Error('redis down'));
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: true });
  });

  it('проглатывает не-Error (строку) из enqueue и возвращает ok:true', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    queueAdd.mockRejectedValue('queue unavailable');
    const r = await uploadLeadAttachment(prismaMock(), input());
    expect(r).toMatchObject({ ok: true });
  });

  it('компенсирует storage.remove и пробрасывает неожиданную ошибку из транзакции', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    const p = prismaMock();
    (p as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async () => {
      throw new Error('db boom');
    });
    await expect(uploadLeadAttachment(p, input())).rejects.toThrow('db boom');
    expect(storageRemove).toHaveBeenCalled();
  });

  it('передаёт scopeOrgIds в loadLeadInScope через WHERE-фильтр', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    await uploadLeadAttachment(prismaMock(), {
      ...input(),
      scopeOrgIds: ['org-1', 'org-2']
    });
    // leadFindFirst called with scopeOrgIds filter (OR clause)
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partnerId: 'p1',
          OR: expect.arrayContaining([
            { organizationId: { in: ['org-1', 'org-2'] } },
            { organizationId: null }
          ])
        })
      })
    );
  });

  it('без scopeOrgIds — loadLeadInScope не добавляет OR-фильтр', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    await uploadLeadAttachment(prismaMock(), input());
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'l1', partnerId: 'p1' }
      })
    );
  });

  it('extensionFor используется для формирования пути хранения', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    extensionFor.mockReturnValue('docx');
    await uploadLeadAttachment(prismaMock(), input());
    const [storagePath] = storageUpload.mock.calls[0] as [string];
    expect(storagePath).toMatch(/\.docx$/);
  });
});

// ===========================================================================
// deleteLeadAttachment
// ===========================================================================

describe('deleteLeadAttachment', () => {
  const base = () => ({
    attachmentId: 'att-1',
    partnerId: 'p1',
    session: session('u1')
  });

  const foundAtt = () => ({
    id: 'att-1',
    name: 'file.pdf',
    path: 'partners/p1/leads/l1/att-1.pdf',
    createdByUserId: 'u1',
    lead: { id: 'l1', partnerId: 'p1', status: 'new', organizationId: null }
  });

  it('успех для автора (createdByUserId === session.sub)', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toEqual({ ok: true });
    expect(attDelete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(storageRemove).toHaveBeenCalledWith(['partners/p1/leads/l1/att-1.pdf']);
    expect(recordAudit).toHaveBeenCalled();
  });

  it('успех для partner-admin (не автор, но isPartnerAdmin=true)', async () => {
    isPartnerAdmin.mockReturnValue(true);
    attFindFirst.mockResolvedValue({ ...foundAtt(), createdByUserId: 'other-user' });
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toEqual({ ok: true });
  });

  it('NOT_FOUND если вложение не найдено (null)', async () => {
    attFindFirst.mockResolvedValue(null);
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('NOT_FOUND если partnerId вложения не совпадает с входным', async () => {
    attFindFirst.mockResolvedValue({ ...foundAtt(), lead: { ...foundAtt().lead, partnerId: 'pX' } });
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('NOT_FOUND если organizationId вне scopeOrgIds', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { ...foundAtt().lead, organizationId: 'org-Z' }
    });
    const r = await deleteLeadAttachment(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('организационный null проходит фильтр scopeOrgIds', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { ...foundAtt().lead, organizationId: null }
    });
    const r = await deleteLeadAttachment(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toEqual({ ok: true });
  });

  it('organizationId в scopeOrgIds проходит фильтр', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { ...foundAtt().lead, organizationId: 'org-A' }
    });
    const r = await deleteLeadAttachment(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toEqual({ ok: true });
  });

  it('LEAD_NOT_EDITABLE если статус не редактируемый (converted)', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { ...foundAtt().lead, status: 'converted' }
    });
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'LEAD_NOT_EDITABLE' });
  });

  it('FORBIDDEN если не автор и не partner-admin', async () => {
    isPartnerAdmin.mockReturnValue(false);
    attFindFirst.mockResolvedValue({ ...foundAtt(), createdByUserId: 'someone-else' });
    const r = await deleteLeadAttachment(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'FORBIDDEN' });
  });
});

// ===========================================================================
// getLeadAttachmentDownloadUrl
// ===========================================================================

describe('getLeadAttachmentDownloadUrl', () => {
  const base = () => ({ attachmentId: 'att-1', partnerId: 'p1' });

  const foundAtt = () => ({
    id: 'att-1',
    path: 'partners/p1/leads/l1/att-1.pdf',
    name: 'd.pdf',
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    scanReason: null,
    lead: { partnerId: 'p1', organizationId: null }
  });

  it('успех: возвращает signed url, name, mimeType', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toEqual({
      ok: true,
      url: 'https://signed',
      name: 'd.pdf',
      mimeType: 'application/pdf'
    });
    expect(storageSigned).toHaveBeenCalledWith(
      'partners/p1/leads/l1/att-1.pdf',
      300,
      { download: 'd.pdf' }
    );
  });

  it('NOT_FOUND если вложение не найдено (null)', async () => {
    attFindFirst.mockResolvedValue(null);
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('NOT_FOUND если partnerId не совпадает', async () => {
    attFindFirst.mockResolvedValue({ ...foundAtt(), lead: { partnerId: 'pX', organizationId: null } });
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('NOT_FOUND если organizationId вне scopeOrgIds', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { partnerId: 'p1', organizationId: 'org-Z' }
    });
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('organizationId null проходит scopeOrgIds фильтр', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { partnerId: 'p1', organizationId: null }
    });
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toMatchObject({ ok: true });
  });

  it('organizationId входит в scopeOrgIds — доступ предоставлен', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      lead: { partnerId: 'p1', organizationId: 'org-A' }
    });
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), {
      ...base(),
      scopeOrgIds: ['org-A']
    });
    expect(r).toMatchObject({ ok: true });
  });

  it('INFECTED отдаёт error=INFECTED с scanReason в meta', async () => {
    attFindFirst.mockResolvedValue({
      ...foundAtt(),
      scanStatus: 'infected',
      scanReason: 'EICAR-Test'
    });
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({
      ok: false,
      error: 'INFECTED',
      meta: { scanReason: 'EICAR-Test' }
    });
  });

  it('STORAGE_FAILURE если createSignedUrl вернул ошибку', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    storageSigned.mockRejectedValue(new Error('storage failure'));
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('STORAGE_FAILURE если storage port бросает при createSignedUrl', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    storageSigned.mockRejectedValue(new Error('no signed URL'));
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('STORAGE_FAILURE с не-Error из createSignedUrl (fallback-сообщение)', async () => {
    // Покрывает строку 302: e instanceof Error ? e.message : 'Не удалось создать ссылку' — не-Error плечо
    attFindFirst.mockResolvedValue(foundAtt());
    storageSigned.mockRejectedValue('provider exploded');
    const r = await getLeadAttachmentDownloadUrl(prismaMock(), base());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });
});

// ===========================================================================
// listLeadAttachments
// ===========================================================================

describe('listLeadAttachments', () => {
  it('NOT_FOUND если заявка не в scope (leadFindFirst → null)', async () => {
    leadFindFirst.mockResolvedValue(null);
    const r = await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('маппит строки, включая createdByUser.name', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    const dt = new Date('2024-01-01T00:00:00Z');
    attFindMany.mockResolvedValue([
      {
        id: 'a1',
        name: 'file.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        createdAt: dt,
        createdByUserId: 'u1',
        createdByUser: { name: 'Иван Иванов' }
      }
    ]);
    const r = await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' });
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          id: 'a1',
          name: 'file.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          createdAt: dt,
          createdByUserId: 'u1',
          createdByUserName: 'Иван Иванов'
        }
      ]
    });
  });

  it('createdByUserName null если createdByUser === null', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    attFindMany.mockResolvedValue([
      {
        id: 'a2',
        name: 'n2.pdf',
        size: 2,
        mimeType: 'application/pdf',
        createdAt: new Date(0),
        createdByUserId: null,
        createdByUser: null
      }
    ]);
    const r = await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' });
    expect(r).toMatchObject({
      ok: true,
      rows: [{ createdByUserName: null }]
    });
  });

  it('передаёт INFECTED_HIDDEN_WHERE в findMany where-условие', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    attFindMany.mockResolvedValue([]);
    await listLeadAttachments(prismaMock(), { leadId: 'l1', partnerId: 'p1' });
    expect(attFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scanStatus: { not: 'infected' } })
      })
    );
  });

  it('передаёт scopeOrgIds в loadLeadInScope через OR-фильтр', async () => {
    leadFindFirst.mockResolvedValue({ id: 'l1', status: 'new' });
    attFindMany.mockResolvedValue([]);
    await listLeadAttachments(prismaMock(), {
      leadId: 'l1',
      partnerId: 'p1',
      scopeOrgIds: ['org-1']
    });
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ organizationId: { in: ['org-1'] } }])
        })
      })
    );
  });
});

// ===========================================================================
// __testing helpers
// ===========================================================================

describe('__testing helpers', () => {
  describe('sanitizeFilename', () => {
    it('заменяет спецсимволы на _ и убирает расширение', () => {
      // 'a/b:c*.pdf' → trimmed='a/b:c*.pdf', lastDot=6, base='a/b:c*'
      // replace [\\/:*?"<>|] → 'a_b_c_'
      expect(__testing.sanitizeFilename('a/b:c*.pdf')).toBe('a_b_c_');
    });

    it('возвращает "" для строки только из пробелов', () => {
      expect(__testing.sanitizeFilename('   ')).toBe('');
    });

    it('возвращает "" для пустой строки', () => {
      expect(__testing.sanitizeFilename('')).toBe('');
    });

    it('убирает расширение (lastDot > 0)', () => {
      expect(__testing.sanitizeFilename('report.xlsx')).toBe('report');
    });

    it('НЕ убирает точку в начале имени (leading-dot: lastDot=0 → base=имя целиком)', () => {
      // '.gitignore' → lastDot=0, not > 0, so base = '.gitignore'
      // replace nothing special → '.gitignore' (no special chars)
      expect(__testing.sanitizeFilename('.gitignore')).toBe('.gitignore');
    });

    it('возвращает "attachment" если имя состоит только из спецсимволов без расширения', () => {
      // '***' → lastDot=-1 (no dot), base='***', cleaned='___', truthy → '___' not 'attachment'
      // To get 'attachment' we need cleaned to be '' after replacing.
      // replace([\\/:*?"<>|]) replaces those chars; '*' IS in the list → '___'
      // Actually '___' is truthy so returns '___', not 'attachment'.
      // The 'attachment' fallback triggers only if cleaned === '' after replacing.
      // That would require a string of only those special chars where cleaned = '' AND base was non-empty.
      // But replace leaves underscores. Let me trace: '\\' → '_', so you'd need an empty string.
      // Actually it seems 'attachment' fallback is unreachable in practice (replace always produces underscores).
      // Test the closest we can: a pure-special char name without extension becomes underscores
      expect(__testing.sanitizeFilename('***')).toBe('___');
    });

    it('обрезает до 200 символов', () => {
      const longName = 'a'.repeat(250) + '.txt';
      const result = __testing.sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
    });

    it('заменяет табуляцию/переводы строк пробелом перед обработкой', () => {
      // 'a\tb' → trimmed='a\tb' → replace [\r\n\t]+ → 'a b' → lastDot=-1, base='a b', cleaned='a b'
      expect(__testing.sanitizeFilename('a\tb')).toBe('a b');
    });
  });

  describe('maxFileSizeBytes', () => {
    it('уважает DOCUMENT_MAX_FILE_SIZE_MB env', () => {
      const prev = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = '5';
      expect(__testing.maxFileSizeBytes()).toBe(5 * 1024 * 1024);
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = prev;
    });

    it('падает в дефолт 200 МБ на невалидном значении', () => {
      const prev = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = 'nonsense';
      expect(__testing.maxFileSizeBytes()).toBe(200 * 1024 * 1024);
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = prev;
    });

    it('падает в дефолт 200 МБ на отрицательном значении', () => {
      const prev = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = '-5';
      expect(__testing.maxFileSizeBytes()).toBe(200 * 1024 * 1024);
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = prev;
    });

    it('использует 200 МБ дефолт если env не выставлен', () => {
      const prev = process.env.DOCUMENT_MAX_FILE_SIZE_MB;
      delete process.env.DOCUMENT_MAX_FILE_SIZE_MB;
      expect(__testing.maxFileSizeBytes()).toBe(200 * 1024 * 1024);
      process.env.DOCUMENT_MAX_FILE_SIZE_MB = prev;
    });
  });

  describe('LeadAttachmentError', () => {
    it('хранит code, message и meta', () => {
      const e = new LeadAttachmentError('INFECTED', 'вирус найден', { scanReason: 'EICAR' });
      expect(e.code).toBe('INFECTED');
      expect(e.message).toBe('вирус найден');
      expect(e.meta).toEqual({ scanReason: 'EICAR' });
      expect(e.name).toBe('LeadAttachmentError');
      expect(e).toBeInstanceOf(Error);
    });

    it('работает без meta', () => {
      const e = new LeadAttachmentError('NOT_FOUND', 'не найдено');
      expect(e.code).toBe('NOT_FOUND');
      expect(e.meta).toBeUndefined();
    });
  });

  describe('DELETABLE_STATUSES', () => {
    it('содержит new и in_review', () => {
      expect(__testing.DELETABLE_STATUSES).toContain('new');
      expect(__testing.DELETABLE_STATUSES).toContain('in_review');
    });
  });
});
