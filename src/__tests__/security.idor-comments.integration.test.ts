import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgOrderComments } from '@/lib/services/partner/orgComments';

/**
 * Security regression (Track E / E2-C) — cross-tenant isolation of the partner
 * "Комментарии" tab.
 *
 * `Company` is the SELLER legal entity (Промтехносфера), shared across every
 * client it serves. The partner org-card comments tab must scope by the CLIENT
 * `organizationId`, NOT by the seller `companyId` — otherwise a partner viewing
 * one org's comments would see the order-comment conversations of EVERY other
 * organization (and every other partner) under the same seller company.
 *
 * Two client orgs (A, B) share ONE seller company; each has an order + comment.
 * The service scoped to org A must never surface org B's comment, and vice
 * versa. Positive controls ensure the filter is not vacuous.
 */

let prisma: PrismaClient;
const STAMP = Date.now(); // fixture-name uniqueness only; assertions use ids

let companyC: string;
let orgA: string, orgB: string;
let orderA: string, orderB: string;
let commentA: string, commentB: string;
let author: string;

beforeAll(async () => {
  prisma = new PrismaClient();

  // ONE seller company shared by both client orgs — the crux of the leak.
  const c = await prisma.company.create({ data: { name: `idorCmtCo-${STAMP}` } });
  companyC = c.id;

  const oA = await prisma.organization.create({
    data: { name: `idorCmtOA-${STAMP}`, companyId: companyC },
  });
  orgA = oA.id;
  const oB = await prisma.organization.create({
    data: { name: `idorCmtOB-${STAMP}`, companyId: companyC },
  });
  orgB = oB.id;

  const u = await prisma.user.create({
    data: { email: `idorCmt-${STAMP}@x.local`, name: `Author ${STAMP}` },
  });
  author = u.id;

  const ordA = await prisma.order.create({
    data: { title: 'A-order', companyId: companyC, organizationId: orgA, totalAmount: 100000 },
  });
  orderA = ordA.id;
  const ordB = await prisma.order.create({
    data: { title: 'B-order', companyId: companyC, organizationId: orgB, totalAmount: 200000 },
  });
  orderB = ordB.id;

  const cmA = await prisma.comment.create({
    data: { orderId: orderA, authorId: author, body: 'A-comment secret' },
  });
  commentA = cmA.id;
  const cmB = await prisma.comment.create({
    data: { orderId: orderB, authorId: author, body: 'B-comment secret' },
  });
  commentB = cmB.id;
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { id: { in: [commentA, commentB] } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } });
  await prisma.user.deleteMany({ where: { id: author } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.company.deleteMany({ where: { id: companyC } });
  await prisma.$disconnect();
});

describe('E2-C — partner org-comments tab is organization-scoped, not seller-company-scoped', () => {
  it('org A comments never include org B (same seller company)', async () => {
    const rows = await listOrgOrderComments(prisma, { orgId: orgA });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentA); // positive control — filter is not vacuous
    expect(ids).not.toContain(commentB); // the leak: B belongs to a sibling org under the same company
  });

  it('symmetry — org B comments never include org A', async () => {
    const rows = await listOrgOrderComments(prisma, { orgId: orgB });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentB);
    expect(ids).not.toContain(commentA);
  });

  it('rows carry the display shape (author name + order title + body)', async () => {
    const rows = await listOrgOrderComments(prisma, { orgId: orgA });
    const row = rows.find((r) => r.id === commentA);
    expect(row).toBeDefined();
    expect(row?.orderId).toBe(orderA);
    expect(row?.orderTitle).toBe('A-order');
    expect(row?.authorName).toBe(`Author ${STAMP}`);
    expect(row?.body).toBe('A-comment secret');
  });
});
