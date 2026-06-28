import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Mock object storage — we cannot hit a real object-storage backend in CI/gate.
// Mirror pattern from api.manager.documents.upload.test.ts: stub the port
// before importing the service under test.
// ---------------------------------------------------------------------------
const { uploadMock, createSignedUrlMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  documentBucket: 'documents',
  getObjectStorage: () => ({
    upload: uploadMock,
    createSignedUrl: createSignedUrlMock,
    remove: vi.fn(),
    download: vi.fn(),
  }),
  StorageError: class StorageError extends Error {},
}));

// new PrismaClient() auto-marks this as integration-mode (vitest.config.ts).
const prisma = new PrismaClient();

import { uploadChatAttachment, getChatAttachmentSignedUrl } from '@/lib/services/chat/attachments';

// ---------------------------------------------------------------------------
// Seed / cleanup
// ---------------------------------------------------------------------------
const PREFIX = 'chat-att-it';
const PARTNER_SLUG = `${PREFIX}-partner`;
const ORG_EXT_ID = `${PREFIX}-org`;
const ORDER_TITLE = `${PREFIX}-order`;

let partnerId: string;
let organizationId: string;
let companyId: string;
let orderId: string;
let managerId: string;
let teamSession: SessionPayload = { sub: '', role: 'manager' };
let orgUserId: string;
let orgSession: SessionPayload = { sub: '', role: 'organization', organizationMemberships: [] };

async function seedData() {
  const partner = await prisma.partner.create({
    data: { name: `${PREFIX}-Partner`, slug: PARTNER_SLUG, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const company = await prisma.company.create({
    data: { name: `${PREFIX}-Company` },
  });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: {
      name: `${PREFIX}-Org`,
      externalId: ORG_EXT_ID,
      partnerId,
      companyId,
    },
  });
  organizationId = org.id;

  const manager = await prisma.user.create({
    data: {
      email: `${PREFIX}-manager@test.local`,
      name: `${PREFIX}-Manager`,
      role: 'manager',
      isActive: true,
    },
  });
  managerId = manager.id;
  // Manager chat visibility is company-scoped (C8) — session carries companyId.
  teamSession = { sub: managerId, role: 'manager', companyId };

  const orgUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-orguser@test.local`,
      name: `${PREFIX}-OrgUser`,
      role: 'organization',
      isActive: true,
      organizationId,
    },
  });
  orgUserId = orgUser.id;
  orgSession = {
    sub: orgUserId,
    role: 'organization',
    organizationMemberships: [{ organizationId, roleInOrg: 'member', isActive: true }],
  };

  const order = await prisma.order.create({
    data: {
      title: ORDER_TITLE,
      partnerId,
      organizationId,
      companyId,
    },
  });
  orderId = order.id;
}

async function cleanupData() {
  // FK-safe order: message → threadReadState → orderThread → order → org → company → partner → users
  await prisma.message.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.threadReadState.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.orderThread.deleteMany({
    where: { order: { title: ORDER_TITLE } },
  });
  await prisma.order.deleteMany({ where: { title: ORDER_TITLE } });
  await prisma.organization.deleteMany({ where: { externalId: ORG_EXT_ID } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });

  const emailsToClean = [
    `${PREFIX}-manager@test.local`,
    `${PREFIX}-orguser@test.local`,
  ];
  const staleUsers = await prisma.user.findMany({
    where: { email: { in: emailsToClean } },
    select: { id: true },
  });
  const staleIds = staleUsers.map((u) => u.id);
  if (managerId && !staleIds.includes(managerId)) staleIds.push(managerId);
  if (orgUserId && !staleIds.includes(orgUserId)) staleIds.push(orgUserId);
  if (staleIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
  }
}

beforeEach(async () => {
  if (companyId) await cleanupData();
  await seedData();
  vi.clearAllMocks();
  // Default: storage upload succeeds
  uploadMock.mockResolvedValue(undefined);
  // Default: signed URL succeeds (port returns the URL string directly)
  createSignedUrlMock.mockResolvedValue('https://storage.example.com/signed?token=test');
});

afterAll(async () => {
  await cleanupData();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Minimal valid PDF bytes (magic bytes %PDF)
// ---------------------------------------------------------------------------
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

describe('uploadChatAttachment integration', () => {
  it('happy path — manager uploads valid PDF → returns chat/<orderId>/... path', async () => {
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.attachmentPath).toMatch(/^chat\//);
    expect(result.attachmentPath).toContain(orderId);
    expect(uploadMock).toHaveBeenCalledTimes(1);

    const [storagePath, buffer, opts] = uploadMock.mock.calls[0]!;
    expect(storagePath).toMatch(new RegExp(`^chat/${orderId}/`));
    expect(buffer).toBe(PDF_MAGIC);
    expect(opts).toMatchObject({ contentType: 'application/pdf' });
  });

  it('org user on org side → upload succeeds (canSeeThread passes)', async () => {
    const result = await uploadChatAttachment(prisma, orgSession, {
      orderId,
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });
    expect(result.ok).toBe(true);
  });

  it('partner with wrong partnerId on side "org" → forbidden', async () => {
    const otherPartner = await prisma.partner.create({
      data: { name: `${PREFIX}-OtherPartner`, commissionRate: 0 },
    });

    const wrongPartnerSession: SessionPayload = {
      sub: 'wrong-partner-user',
      role: 'partner',
      partnerId: otherPartner.id,
    };

    const result = await uploadChatAttachment(prisma, wrongPartnerSession, {
      orderId,
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(uploadMock).not.toHaveBeenCalled();

    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });

  it('missing order → order_not_found', async () => {
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId: 'non-existent-id',
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });
    expect(result).toEqual({ ok: false, error: 'order_not_found' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('file too large → too_large', async () => {
    const TWENTY_ONE_MB = 21 * 1024 * 1024;
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'big.pdf',
        size: TWENTY_ONE_MB,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC, // actual buffer irrelevant — size check is first
      },
    });
    expect(result).toEqual({ ok: false, error: 'too_large' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('unsupported MIME type → invalid_mime', async () => {
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'virus.exe',
        size: 8,
        mimeType: 'application/x-msdownload',
        buffer: Buffer.alloc(8),
      },
    });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('MIME declared as PDF but bytes are not PDF → invalid_mime (magic byte mismatch)', async () => {
    const notPdf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'fake.pdf',
        size: notPdf.length,
        mimeType: 'application/pdf',
        buffer: notPdf,
      },
    });
    expect(result).toEqual({ ok: false, error: 'invalid_mime' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('storage upload error → storage', async () => {
    uploadMock.mockRejectedValue(new Error('connection refused'));
    const result = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });
    expect(result).toEqual({ ok: false, error: 'storage' });
  });
});

describe('getChatAttachmentSignedUrl integration', () => {
  it('message with attachmentPath + authorized viewer → signed URL returned', async () => {
    // First upload to get an attachmentPath
    const uploadResult = await uploadChatAttachment(prisma, teamSession, {
      orderId,
      side: 'org',
      file: {
        name: 'test.pdf',
        size: PDF_MAGIC.length,
        mimeType: 'application/pdf',
        buffer: PDF_MAGIC,
      },
    });
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) throw new Error('upload failed');

    // Create a message row with the attachmentPath
    const thread = await prisma.orderThread.upsert({
      where: { orderId_side: { orderId, side: 'org' } },
      update: {},
      create: { orderId, side: 'org' },
    });
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: managerId,
        body: 'see attachment',
        attachmentPath: uploadResult.attachmentPath,
      },
    });

    const result = await getChatAttachmentSignedUrl(prisma, teamSession, msg.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.url).toBe('https://storage.example.com/signed?token=test');
    expect(createSignedUrlMock).toHaveBeenCalledWith(uploadResult.attachmentPath, 600);
  });

  it('message without attachmentPath → not_found', async () => {
    const thread = await prisma.orderThread.upsert({
      where: { orderId_side: { orderId, side: 'org' } },
      update: {},
      create: { orderId, side: 'org' },
    });
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: managerId,
        body: 'text only, no attachment',
        attachmentPath: null,
      },
    });

    const result = await getChatAttachmentSignedUrl(prisma, teamSession, msg.id);
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('non-existent messageId → not_found', async () => {
    const result = await getChatAttachmentSignedUrl(prisma, teamSession, 'non-existent-id');
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('org user on wrong org → forbidden', async () => {
    // Create a message on the seeded order's thread
    const thread = await prisma.orderThread.upsert({
      where: { orderId_side: { orderId, side: 'org' } },
      update: {},
      create: { orderId, side: 'org' },
    });
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: managerId,
        body: 'see attachment',
        attachmentPath: `chat/${orderId}/some-file.pdf`,
      },
    });

    // A different org that does NOT own this order
    const wrongOrgSession: SessionPayload = {
      sub: 'u-org-wrong',
      role: 'organization',
      organizationMemberships: [{ organizationId: 'other-org-id', roleInOrg: 'member', isActive: true }],
    };
    const result = await getChatAttachmentSignedUrl(prisma, wrongOrgSession, msg.id);
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  // FIX 1: belt-and-suspenders — message with non-chat/ path is rejected before signed URL
  it('message with non-chat/ attachmentPath (e.g. orders/...) → not_found, createSignedUrl NOT called', async () => {
    const thread = await prisma.orderThread.upsert({
      where: { orderId_side: { orderId, side: 'org' } },
      update: {},
      create: { orderId, side: 'org' },
    });
    // Simulate a legacy/edge row with a path outside chat/
    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        authorId: managerId,
        body: 'sneaky',
        attachmentPath: 'orders/victim-order-id/secret.pdf',
      },
    });

    const result = await getChatAttachmentSignedUrl(prisma, teamSession, msg.id);
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
