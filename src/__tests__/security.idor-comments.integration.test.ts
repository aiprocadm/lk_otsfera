import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOrganizationCard } from '@/lib/services/manager/organizationCard';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Security regression (Track E / E2-C) — изоляция вкладки «Комментарии»
 * карточки организации у партнёра.
 *
 * `Company` — продавец (Промтехносфера), одна на всех клиентов. Комментарии
 * в карточке должны скопиться по КЛИЕНТСКОЙ `organizationId`, а не по
 * `companyId` продавца — иначе партнёр, открыв одну организацию, увидит
 * переписку по заказам всех организаций (и всех партнёров) того же продавца.
 *
 * Хотфикс №12 сопровождения: раньше тест бил в отдельный сервис
 * `partner/orgComments.ts`, который в проде давно не вызывался (экран
 * партнёра ушёл на общую карточку `organizationCard.ts`), — страж охранял
 * мёртвый код. Теперь проверяется живой путь: `getOrganizationCard` с
 * партнёрской сессией, и список, и счётчик вкладки (`tabTotals.activity`).
 *
 * Две клиентские организации (A, B) — один продавец, один партнёр; у каждой
 * заказ и комментарий. Карточка A не должна отдать комментарий B, и наоборот;
 * положительные проверки — чтобы фильтр не оказался пустым.
 */

let prisma: PrismaClient;
const STAMP = Date.now(); // только уникальность имён фикстур; проверки — по id

let companyC: string;
let partnerP: string;
let orgA: string, orgB: string;
let orderA: string, orderB: string;
let commentA: string, commentB: string;
let author: string;

const partnerSession = (): SessionPayload =>
  ({ sub: `u-${partnerP}`, role: 'partner', partnerId: partnerP }) as unknown as SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();

  // ОДИН продавец на обе клиентские организации — суть возможной утечки.
  const c = await prisma.company.create({ data: { name: `idorCmtCo-${STAMP}` } });
  companyC = c.id;
  const p = await prisma.partner.create({ data: { name: `idorCmtP-${STAMP}` } });
  partnerP = p.id;

  const oA = await prisma.organization.create({
    data: { name: `idorCmtOA-${STAMP}`, companyId: companyC, partnerId: partnerP },
  });
  orgA = oA.id;
  const oB = await prisma.organization.create({
    data: { name: `idorCmtOB-${STAMP}`, companyId: companyC, partnerId: partnerP },
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
  await prisma.partner.deleteMany({ where: { id: partnerP } });
  await prisma.company.deleteMany({ where: { id: companyC } });
  await prisma.$disconnect();
});

describe('E2-C — комментарии карточки организации у партнёра скоплены по организации, не по продавцу', () => {
  it('в карточке A нет комментария B (тот же продавец, тот же партнёр)', async () => {
    const card = await getOrganizationCard(prisma, partnerSession(), orgA);
    expect(card).not.toBeNull();
    const ids = card!.activity.map((r) => r.id);
    expect(ids).toContain(commentA);
    expect(ids).not.toContain(commentB);
  });

  it('симметрично — в карточке B нет комментария A', async () => {
    const card = await getOrganizationCard(prisma, partnerSession(), orgB);
    expect(card).not.toBeNull();
    const ids = card!.activity.map((r) => r.id);
    expect(ids).toContain(commentB);
    expect(ids).not.toContain(commentA);
  });

  it('счётчик вкладки считает по тому же скоупу, что и список', async () => {
    const card = await getOrganizationCard(prisma, partnerSession(), orgA);
    expect(card!.tabTotals.activity).toBe(1);
    expect(card!.activity).toHaveLength(1);
  });

  it('строка несёт поля для показа (имя автора + заказ + текст)', async () => {
    const card = await getOrganizationCard(prisma, partnerSession(), orgA);
    const row = card!.activity.find((r) => r.id === commentA);
    expect(row).toMatchObject({
      authorName: `Author ${STAMP}`,
      orderId: orderA,
      body: 'A-comment secret',
    });
  });
});
