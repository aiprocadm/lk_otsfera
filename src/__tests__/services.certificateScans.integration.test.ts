/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) integration: пачка сканов на живой БД.
 *
 * Проверяем то, что моками не докажешь: реальные строки `Document`, связь
 * `Certificate.documentId` и то, что после загрузки пачки чек-лист готовности
 * (PR-1) действительно закрывается.
 *
 * Объектное хранилище и очередь скана замоканы — они не часть проверяемого
 * инварианта, а MinIO/Redis в прогоне тестов может не быть.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';

const { upload } = vi.hoisted(() => ({ upload: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload }) }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: vi.fn().mockResolvedValue({}) }) }));

import {
  listCertificateScanTargets,
  uploadCertificateScans,
} from '@/lib/services/manager/certificateScans';
import { getOrderReadiness } from '@/lib/services/manager/orderDelivery';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const RUN = `scans-${process.pid}`;

let companyId: string;
let orgId: string;
let managerId: string;
let directionId: string;
let orderId: string;
let itemIvanovId: string;
let itemPetrovaId: string;
let itemNoCertId: string;

const manager = (): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId,
    managedOrgIds: [orgId],
  }) as unknown as SessionPayload;

function pdf(name: string) {
  // %PDF — валидные magic bytes, иначе upload-core отклонит по MIME.
  return { name, size: 8, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };
}

async function makeItemWithCertificate(studentName: string, withCert: boolean): Promise<string> {
  const student = await prisma.student.create({
    data: {
      name: studentName,
      email: `${RUN}-${Math.random().toString(36).slice(2, 8)}@t.local`,
      organizationId: orgId,
    },
  });
  const item = await prisma.orderItem.create({
    data: { orderId, studentId: student.id, directionId, trainingStatus: 'certificate_issued' },
  });
  if (withCert) {
    await prisma.certificate.create({
      data: {
        number: `${RUN}-${studentName}`,
        studentId: student.id,
        organizationId: orgId,
        directionId,
        orderItemId: item.id,
        issuedAt: new Date('2026-06-01'),
      },
    });
  }
  return item.id;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `${RUN}-co` } });
  companyId = company.id;
  const org = await prisma.organization.create({ data: { name: `${RUN}-org`, companyId } });
  orgId = org.id;
  const mgr = await prisma.user.create({
    data: { email: `${RUN}-m@t.local`, name: 'M', role: 'manager', passwordHash: 'x', companyId },
  });
  managerId = mgr.id;
  const dir = await prisma.trainingDirection.create({
    data: { name: `${RUN}-dir`, isActive: true },
  });
  directionId = dir.id;

  const order = await prisma.order.create({
    data: {
      title: `${RUN}-order`,
      companyId,
      organizationId: orgId,
      managerId,
      serviceType: 'training',
      totalAmount: new Prisma.Decimal('1000.00'),
      paidAmount: new Prisma.Decimal('1000.00'),
      financialStatus: 'paid',
      executionStatus: 'completed',
    },
  });
  orderId = order.id;

  itemIvanovId = await makeItemWithCertificate('Иванов Иван', true);
  itemPetrovaId = await makeItemWithCertificate('Петрова Анна', true);
  itemNoCertId = await makeItemWithCertificate('Сидоров Пётр', false);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: managerId } });
  await prisma.certificate.deleteMany({ where: { organizationId: orgId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.document.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.student.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.trainingDirection.delete({ where: { id: directionId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('массовая загрузка сканов удостоверений (ФТ-5.3)', () => {
  it('цели загрузки показывают, у кого есть удостоверение и есть ли скан', async () => {
    const res = await listCertificateScanTargets(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const byItem = new Map(res.targets.map((t) => [t.itemId, t]));
    expect(byItem.get(itemIvanovId)).toMatchObject({ hasScan: false });
    expect(byItem.get(itemIvanovId)?.certificateId).not.toBeNull();
    expect(byItem.get(itemNoCertId)).toMatchObject({ certificateId: null, hasScan: false });
  });

  it('до загрузки заказ не готов — по обоим удостоверениям нет скана', async () => {
    const res = await getOrderReadiness(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.readiness.ready).toBe(false);
    const gaps = res.readiness.items.flatMap((i) => i.gaps);
    expect(gaps).toContain('certificate_scan_missing');
  });

  it('пачка из двух файлов: оба удостоверения получают скан, третий файл отклонён', async () => {
    const res = await uploadCertificateScans(prisma, manager(), {
      orderId,
      files: [
        { orderItemId: itemIvanovId, file: pdf('Иванов.pdf') },
        { orderItemId: itemPetrovaId, file: pdf('Петрова.pdf') },
        { orderItemId: itemNoCertId, file: pdf('Сидоров.pdf') },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(res.results[2]).toMatchObject({ error: 'certificate_missing' });

    // Реальные документы заказа: ровно два, оба исходящие и типа certificate.
    const docs = await prisma.document.findMany({ where: { orderId } });
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.direction === 'outgoing' && d.type === 'certificate')).toBe(true);

    // Связь проставлена именно тем документам, что вернул сервис.
    const certs = await prisma.certificate.findMany({
      where: { orderItemId: { in: [itemIvanovId, itemPetrovaId] } },
    });
    expect(certs.every((c) => c.documentId !== null)).toBe(true);
    expect(new Set(certs.map((c) => c.documentId))).toEqual(
      new Set(res.results.filter((r) => r.ok).map((r) => (r.ok ? r.documentId : null)))
    );

    // Аудит связи — по одному на каждое удостоверение.
    const audit = await prisma.auditLog.findMany({
      where: { userId: managerId, action: 'certificate_scan_attached' },
    });
    expect(audit).toHaveLength(2);
  });

  it('после загрузки чек-лист по слушателям с удостоверениями закрыт', async () => {
    const res = await getOrderReadiness(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Остаётся только позиция без удостоверения — сканы своё дело сделали.
    const remaining = res.readiness.items.flatMap((i) => i.gaps);
    expect(remaining).not.toContain('certificate_scan_missing');
    expect(remaining).toEqual(['certificate_missing']);
  });

  it('заражённый скан снова открывает пробел (ФТ-5.3)', async () => {
    const cert = await prisma.certificate.findFirst({ where: { orderItemId: itemIvanovId } });
    await prisma.document.update({
      where: { id: cert!.documentId! },
      data: { scanStatus: 'infected', scanReason: 'Eicar-Test-Signature' },
    });

    const res = await getOrderReadiness(prisma, manager(), orderId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const gaps = res.readiness.items.flatMap((i) => i.gaps);
    expect(gaps).toContain('certificate_scan_infected');

    // Возвращаем чистый статус, чтобы порядок тестов не влиял на соседей.
    await prisma.document.update({
      where: { id: cert!.documentId! },
      data: { scanStatus: 'clean', scanReason: null },
    });
  });

  it('заказ вне скоупа менеджера не отдаёт цели и не принимает файлы', async () => {
    const alien = {
      sub: 'ghost',
      role: 'manager',
      companyId: 'other-co',
      managedOrgIds: [],
    } as unknown as SessionPayload;
    expect(await listCertificateScanTargets(prisma, alien, orderId)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const res = await uploadCertificateScans(prisma, alien, {
      orderId,
      files: [{ orderItemId: itemIvanovId, file: pdf('Иванов.pdf') }],
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});
