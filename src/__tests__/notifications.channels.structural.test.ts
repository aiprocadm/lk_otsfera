/**
 * Структурный тест приёмки трека D: «добавление канала не требует правок в
 * местах генерации событий». Мокаем реестр каналов, добавляя fake-канал, и
 * проверяем, что notifyOrgUsers доставляет в него — без единой правки org.ts.
 *
 * Integration (живой Postgres): нужен реальный fan-out notifyOrgUsers с
 * созданием Notification-строк и получателей организации.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const { fakeSend, fakeIsEnabledFor } = vi.hoisted(() => ({
  fakeSend: vi.fn(),
  fakeIsEnabledFor: vi.fn(),
}));

// Реестр каналов — единственная точка расширения. Подменяем его целиком на
// один fake-канал: если fan-out доставит в него без правок org.ts, критерий
// «канал без правок мест генерации» выполнен структурно.
vi.mock('@/lib/notifications/channels/registry', () => ({
  getChannels: () => [
    { key: 'fake', isEnabledFor: fakeIsEnabledFor, send: fakeSend },
  ],
}));
// notif_queue не трогаем — inline-путь (dispatchToRecipient без Redis).

import { notifyOrgUsers } from '@/lib/notifications/org';

const prisma = new PrismaClient();
const STAMP = Date.now();
const ids: Record<string, string> = {};

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `struct-co-${STAMP}` } });
  const org = await prisma.organization.create({
    data: { name: `struct-org-${STAMP}`, companyId: company.id },
  });
  const user = await prisma.user.create({
    data: {
      email: `struct-user-${STAMP}@test.ru`,
      name: 'Struct User',
      role: 'organization',
      organizationId: org.id,
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: org.id, userId: user.id, roleInOrg: 'member', isActive: true },
  });
  Object.assign(ids, { company: company.id, org: org.id, user: user.id });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { organizationId: ids.org } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: ids.org } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.organization.delete({ where: { id: ids.org } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('структурная приёмка: канал без правок мест генерации', () => {
  it('notifyOrgUsers доставляет в fake-канал через реестр (org.ts не менялся)', async () => {
    fakeIsEnabledFor.mockReturnValue(true);
    fakeSend.mockResolvedValue({ status: 'sent' });

    const summary = await notifyOrgUsers(prisma, {
      organizationId: ids.org,
      type: 'document_published',
      payload: {
        orderId: null,
        orderNumber: null,
        orderTitle: null,
        documentName: 'Договор.pdf',
        documentType: 'contract',
      },
    });

    // In-app строка создана (источник истины), fan-out прошёл по получателю.
    expect(summary.recipientsNotified).toBe(1);
    // Fake-канал получил доставку — доказательство расширяемости без правок.
    expect(fakeSend).toHaveBeenCalledTimes(1);
    const [recipient, payload] = fakeSend.mock.calls[0];
    expect(recipient.id).toBe(ids.user);
    expect(payload.type).toBe('document_published');
    expect(payload.title).toContain('документ');
  });

  it('канал, выключенный для пользователя, не получает доставку', async () => {
    fakeIsEnabledFor.mockReturnValue(false);

    await notifyOrgUsers(prisma, {
      organizationId: ids.org,
      type: 'document_published',
      payload: {
        orderId: null,
        orderNumber: null,
        orderTitle: null,
        documentName: 'Акт.pdf',
        documentType: 'act',
      },
    });

    expect(fakeSend).not.toHaveBeenCalled();
  });
});
