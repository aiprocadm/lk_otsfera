import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STAMP = `m2sc${Date.now()}`;

afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('M2 Contact schema', () => {
  it('creates a Contact with a channel; per-company uniqueness holds', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        name: `${STAMP}-Иван`,
        channels: {
          create: [
            {
              companyId: company.id,
              type: 'phone',
              value: `${STAMP}+79990001122`,
              normalizedValue: '+79990001122',
              isPrimary: true,
            },
          ],
        },
      },
      include: { channels: true },
    });
    expect(contact.channels).toHaveLength(1);
    expect(contact.organizationId).toBeNull();

    await expect(
      prisma.contactChannel.create({
        data: {
          contactId: contact.id,
          companyId: company.id,
          type: 'phone',
          value: 'dup',
          normalizedValue: '+79990001122',
        },
      })
    ).rejects.toThrow();

    const company2 = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
    const contact2 = await prisma.contact.create({
      data: { companyId: company2.id, name: `${STAMP}-Пётр` },
    });
    const ok = await prisma.contactChannel.create({
      data: {
        contactId: contact2.id,
        companyId: company2.id,
        type: 'phone',
        value: `${STAMP}b`,
        normalizedValue: '+79990001122',
      },
    });
    expect(ok.id).toBeTruthy();
  });
});
