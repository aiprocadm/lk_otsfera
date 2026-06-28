import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('training schema', () => {
  it('создаёт направление, позицию и удостоверение со связями', async () => {
    const dir = await prisma.trainingDirection.create({ data: { name: 'Охрана труда' } });
    const company = await prisma.company.create({ data: { name: 'C' } });
    const org = await prisma.organization.create({ data: { name: 'O', companyId: company.id } });
    const student = await prisma.student.create({
      data: { name: 'Иванов', email: 'iv@o.ru', organizationId: org.id }
    });
    const order = await prisma.order.create({
      data: { title: 'T', companyId: company.id, organizationId: org.id }
    });
    const item = await prisma.orderItem.create({
      data: { orderId: order.id, studentId: student.id, directionId: dir.id }
    });
    expect(item.trainingStatus).toBe('pending');
    const cert = await prisma.certificate.create({
      data: {
        studentId: student.id, organizationId: org.id, directionId: dir.id,
        orderItemId: item.id, number: 'УД-1', issuedAt: new Date()
      }
    });
    expect(cert.validUntil).toBeNull();
    await prisma.certificate.delete({ where: { id: cert.id } });
    await prisma.orderItem.delete({ where: { id: item.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.trainingDirection.delete({ where: { id: dir.id } });
  });

  it('запрещает дубль позиции (orderId+studentId+directionId)', async () => {
    const dir = await prisma.trainingDirection.create({ data: { name: 'ПБ' } });
    const company = await prisma.company.create({ data: { name: 'C2' } });
    const org = await prisma.organization.create({ data: { name: 'O2', companyId: company.id } });
    const student = await prisma.student.create({
      data: { name: 'Петров', email: 'pe@o2.ru', organizationId: org.id }
    });
    const order = await prisma.order.create({
      data: { title: 'T2', companyId: company.id, organizationId: org.id }
    });
    await prisma.orderItem.create({ data: { orderId: order.id, studentId: student.id, directionId: dir.id } });
    await expect(
      prisma.orderItem.create({ data: { orderId: order.id, studentId: student.id, directionId: dir.id } })
    ).rejects.toThrow();
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.trainingDirection.delete({ where: { id: dir.id } });
  });
});
