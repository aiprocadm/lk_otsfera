import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { markDocumentViewed, viewedDocumentIds } from '@/lib/services/documents/viewMarks';

/**
 * Этап 3 PR-2 (ФТ-6.6): отметки просмотра на живом Postgres — уникальность
 * (document, user), идемпотентный повторный просмотр (upsert обновляет
 * viewedAt), каскадное удаление вместе с документом.
 */

const prisma = new PrismaClient();
const T = 'dvm3-int';

let userId = '';
let companyId = '';
let docA = '';
let docB = '';

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { id: `${T}-user` },
    update: {},
    create: {
      id: `${T}-user`,
      email: `${T}-user@x.test`,
      name: 'Просмотрщик',
      role: 'organization',
    },
  });
  userId = user.id;
  const company = await prisma.company.create({ data: { name: `${T}-Компания` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `${T}-Организация` } });
  const mkDoc = (name: string) =>
    prisma.document.create({
      data: {
        name,
        path: `${T}/${name}`,
        mimeType: 'application/pdf',
        companyId,
        counterpartyType: 'organization',
        counterpartyId: org.id,
      },
    });
  docA = (await mkDoc(`${T}-a.pdf`)).id;
  docB = (await mkDoc(`${T}-b.pdf`)).id;
});

afterAll(async () => {
  await prisma.documentViewMark.deleteMany({ where: { userId } });
  await prisma.document.deleteMany({ where: { path: { startsWith: T } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: T } } });
  await prisma.user.deleteMany({ where: { id: `${T}-user` } });
  await prisma.$disconnect();
});

describe('viewMarks (integration)', () => {
  it('первая отметка создаёт строку; повторная не плодит дублей и двигает viewedAt', async () => {
    await markDocumentViewed(prisma, { documentId: docA, userId });
    const first = await prisma.documentViewMark.findUniqueOrThrow({
      where: { documentId_userId: { documentId: docA, userId } },
    });

    await new Promise((r) => setTimeout(r, 15));
    await markDocumentViewed(prisma, { documentId: docA, userId });
    const rows = await prisma.documentViewMark.findMany({ where: { documentId: docA, userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].viewedAt.getTime()).toBeGreaterThan(first.viewedAt.getTime());
  });

  it('viewedDocumentIds отдаёт только просмотренные этим пользователем', async () => {
    const viewed = await viewedDocumentIds(prisma, { userId, documentIds: [docA, docB] });
    expect(viewed.has(docA)).toBe(true);
    expect(viewed.has(docB)).toBe(false);

    const other = await viewedDocumentIds(prisma, { userId: `${T}-другой`, documentIds: [docA] });
    expect(other.size).toBe(0);
  });

  it('удаление документа каскадно удаляет отметки', async () => {
    await markDocumentViewed(prisma, { documentId: docB, userId });
    await prisma.document.delete({ where: { id: docB } });
    const rows = await prisma.documentViewMark.findMany({ where: { documentId: docB } });
    expect(rows).toHaveLength(0);
  });
});
