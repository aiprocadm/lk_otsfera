import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

// Очередь мокается целиком: процессор её не трогает, но сервис пакета в том же
// графе импортов поднял бы настоящее соединение с Redis.
// `add` обязан возвращать обещание: боевой код вешает на него `.catch`, и мок,
// отдающий undefined, ронял бы перенос там, где очередь просто недоступна.
const { getQueue, queueAdd } = vi.hoisted(() => {
  const queueAdd = vi.fn(async () => undefined);
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { bitrixImportProcessor } from '@/worker/processors/bitrix-import';
import type { BitrixImportJobPayload } from '@/lib/jobs/types';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';

/**
 * Этап 2 (`У-193`, `У-202`): сухой прогон пакета миграции на живой базе.
 *
 * Проверяется то, ради чего предпросмотр и существует: числа, которые увидит
 * человек. Источник — фикстура портала (`FAKE_BITRIX=1`), поэтому ожидания
 * можно писать точными: 5 компаний, 8 контактов, 6 лидов, 6 сделок, 4 задачи.
 * Заодно закреплено главное правило безопасности: выключенный флаг
 * останавливает пакет, а не роняет задачу в бесконечные повторы.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
const ids = { company: '', user: '', batches: [] as string[] };

type EntityCount = { create: number; update: number; skip: number; conflict: number };
type BatchSettings = {
  stagesFound?: unknown[];
  usersFound?: unknown[];
  rows?: { entity: string; reason?: string }[];
  tables?: { stageMap: Record<string, string | null> };
};

/** Полное сопоставление стадий — иначе сделки и лиды ждали бы решения. */
const FULL_TABLES = {
  stageMap: {
    '0:NEW': 'default:new',
    '0:PREPARATION': 'default:negotiation',
    '0:EXECUTING': 'default:proposal',
    '0:WON': 'default:won',
    '0:LOSE': 'default:lost',
  },
  leadStageMap: {
    NEW: 'default:new',
    IN_PROCESS: 'default:in_review',
    CONVERTED: 'default:promoted_to_deal',
    JUNK: 'default:rejected',
  },
};

/** Ключи файлов фикстуры портала — их документы уникальны на всю базу. */
const FIXTURE_FILE_IDS = ['701', '702', '703'];

/** Полная уборка данных кабинета в порядке связей. */
async function wipeCompanyData(): Promise<void> {
  await prisma.bitrixImportWrite.deleteMany({ where: { batch: { companyId: ids.company } } });
  // `bitrixId` уникален ГЛОБАЛЬНО, поэтому документы фикстуры убираются по
  // ключу, а не по компании: иначе чужой остаток сломал бы перенос файлов.
  await prisma.document.deleteMany({
    where: { OR: [{ companyId: ids.company }, { bitrixId: { in: FIXTURE_FILE_IDS } }] },
  });
  await prisma.orderStatusChange.deleteMany({ where: { order: { companyId: ids.company } } });
  await prisma.dealNote.deleteMany({ where: { deal: { companyId: ids.company } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId: ids.company } } });
  await prisma.task.deleteMany({ where: { companyId: ids.company } });
  await prisma.deal.deleteMany({ where: { companyId: ids.company } });
  await prisma.order.deleteMany({ where: { companyId: ids.company } });
  await prisma.lead.deleteMany({ where: { createdByUserId: ids.user } });
  await prisma.organizationNote.deleteMany({ where: { companyId: ids.company } });
  await prisma.contactChannel.deleteMany({ where: { companyId: ids.company } });
  await prisma.contact.deleteMany({ where: { companyId: ids.company } });
  await prisma.organizationManager.deleteMany({
    where: { organization: { companyId: ids.company } },
  });
  await prisma.organization.deleteMany({ where: { companyId: ids.company } });
}

/** Слепок «сколько чего в кабинете» — им сравнивается повторный прогон. */
async function snapshotCounts(): Promise<Record<string, number>> {
  const [organizations, contacts, leads, deals, tasks, orders, orgNotes, dealNotes] =
    await Promise.all([
      prisma.organization.count({ where: { companyId: ids.company } }),
      prisma.contact.count({ where: { companyId: ids.company } }),
      prisma.lead.count({ where: { createdByUserId: ids.user } }),
      prisma.deal.count({ where: { companyId: ids.company } }),
      prisma.task.count({ where: { companyId: ids.company } }),
      prisma.order.count({ where: { companyId: ids.company } }),
      prisma.organizationNote.count({ where: { companyId: ids.company } }),
      prisma.dealNote.count({ where: { deal: { companyId: ids.company } } }),
    ]);
  return { organizations, contacts, leads, deals, tasks, orders, orgNotes, dealNotes };
}

function job(name: string, batchId: string): Job<BitrixImportJobPayload> {
  return { id: `test-bitrix-${STAMP}`, name, data: { batchId } } as Job<BitrixImportJobPayload>;
}

async function createBatch(settings: Record<string, unknown> = {}): Promise<string> {
  const batch = await prisma.bitrixImportBatch.create({
    data: {
      companyId: ids.company,
      importedById: ids.user,
      source: 'rest',
      status: 'preview_pending',
      settings: { withFiles: true, openOnly: false, ...settings },
      counts: {},
    },
    select: { id: true },
  });
  ids.batches.push(batch.id);
  return batch.id;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({
    data: { name: `Тест миграции ${STAMP}` },
    select: { id: true },
  });
  ids.company = company.id;
  const user = await prisma.user.create({
    data: {
      email: `bitrix-import-${STAMP}@test.local`,
      name: 'Администратор миграции',
      role: 'admin',
      companyId: company.id,
    },
    select: { id: true },
  });
  ids.user = user.id;
  process.env.FAKE_BITRIX = '1';
  process.env.FEATURE_BITRIX_MIGRATION = '1';
});

beforeEach(() => {
  vi.clearAllMocks();
  resetIntegrationSettingsCache();
  process.env.FEATURE_BITRIX_MIGRATION = '1';
});

afterAll(async () => {
  // Применение пишет по-настоящему, поэтому убирать надо в порядке связей.
  await prisma.bitrixImportWrite.deleteMany({ where: { batch: { companyId: ids.company } } });
  await prisma.bitrixImportBatch.deleteMany({ where: { companyId: ids.company } });
  await prisma.document.deleteMany({
    where: { OR: [{ companyId: ids.company }, { bitrixId: { in: FIXTURE_FILE_IDS } }] },
  });
  await prisma.orderStatusChange.deleteMany({ where: { order: { companyId: ids.company } } });
  await prisma.dealNote.deleteMany({ where: { deal: { companyId: ids.company } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { companyId: ids.company } } });
  await prisma.task.deleteMany({ where: { companyId: ids.company } });
  await prisma.deal.deleteMany({ where: { companyId: ids.company } });
  await prisma.order.deleteMany({ where: { companyId: ids.company } });
  await prisma.lead.deleteMany({ where: { createdByUserId: ids.user } });
  await prisma.organizationNote.deleteMany({ where: { companyId: ids.company } });
  await prisma.contactChannel.deleteMany({ where: { companyId: ids.company } });
  await prisma.contact.deleteMany({ where: { companyId: ids.company } });
  await prisma.organizationManager.deleteMany({
    where: { organization: { companyId: ids.company } },
  });
  await prisma.organization.deleteMany({ where: { companyId: ids.company } });
  await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.company.deleteMany({ where: { id: ids.company } });
  await prisma.$disconnect();
  delete process.env.FAKE_BITRIX;
  delete process.env.FEATURE_BITRIX_MIGRATION;
});

describe('bitrixImportProcessor — сухой прогон пакета', () => {
  it('без сопоставления и менеджера: что можно — посчитано, остальное ждёт решения', async () => {
    const batchId = await createBatch();

    const result = await bitrixImportProcessor(job('preview', batchId), prisma);
    expect(result).toMatchObject({ batchId, status: 'preview' });

    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true, counts: true, settings: true, startedAt: true },
    });
    expect(saved.status).toBe('preview');
    expect(saved.startedAt).not.toBeNull();

    const counts = saved.counts as Record<string, EntityCount> & { total: number };
    // Организации и контакты не зависят от сопоставления — они переносятся сразу.
    expect(counts.organization).toMatchObject({ create: 5, conflict: 0 });
    expect(counts.contact).toMatchObject({ create: 8, conflict: 0 });
    // Лид без ответственного не виден никому, поэтому без менеджера по
    // умолчанию все шесть ждут решения, а не создаются втихую.
    expect(counts.lead).toMatchObject({ create: 0, conflict: 6 });
    // Две стадии портала («Подготовка документов», «В работе») не совпали с
    // стадиями кабинета по названию — их сделки тоже ждут решения.
    expect(counts.deal).toMatchObject({ create: 4, conflict: 2 });
    expect(counts.total).toBeGreaterThan(30);

    const settings = saved.settings as BatchSettings;
    expect(settings.stagesFound?.length).toBeGreaterThan(0);
    expect(settings.usersFound).toHaveLength(3);
    // «Сделка успешна» и «Сделка провалена» сопоставляются сами по семантике.
    expect(settings.tables?.stageMap['0:WON']).toBe('default:won');
    expect(settings.tables?.stageMap['0:LOSE']).toBe('default:lost');
    expect(settings.tables?.stageMap['0:EXECUTING']).toBeNull();
    // Строки «нужно решение» объясняют человеку причину его словами.
    const leadRow = settings.rows?.find((r) => r.entity === 'lead');
    expect(leadRow?.reason).toContain('некому назначить ответственного');
  });

  it('с менеджером и полным сопоставлением переносится всё', async () => {
    const batchId = await createBatch({
      defaultManagerId: ids.user,
      tables: {
        stageMap: {
          '0:NEW': 'default:new',
          '0:PREPARATION': 'default:negotiation',
          '0:EXECUTING': 'default:proposal',
          '0:WON': 'default:won',
          '0:LOSE': 'default:lost',
        },
        leadStageMap: {
          NEW: 'default:new',
          IN_PROCESS: 'default:in_review',
          CONVERTED: 'default:promoted_to_deal',
          JUNK: 'default:rejected',
        },
      },
    });

    await bitrixImportProcessor(job('preview', batchId), prisma);

    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { counts: true, settings: true },
    });
    const counts = saved.counts as Record<string, EntityCount>;
    expect(counts.lead).toMatchObject({ create: 6, conflict: 0 });
    expect(counts.deal).toMatchObject({ create: 6, conflict: 0 });
    expect(counts.task).toMatchObject({ create: 4, conflict: 0 });
    // Две выигранные сделки просят заказ: в чистой базе его ещё нет.
    expect(counts.order).toMatchObject({ create: 2 });
    // Заметки из комментариев: пустой комментарий фикстуры не переносится.
    expect(counts.note.create).toBeGreaterThan(0);
  });

  it('сухой прогон ничего не пишет: ни организаций, ни контактов не прибавилось', async () => {
    const before = await Promise.all([
      prisma.organization.count({ where: { companyId: ids.company } }),
      prisma.contact.count({ where: { companyId: ids.company } }),
      prisma.deal.count({ where: { companyId: ids.company } }),
    ]);

    await bitrixImportProcessor(job('preview', await createBatch()), prisma);

    const after = await Promise.all([
      prisma.organization.count({ where: { companyId: ids.company } }),
      prisma.contact.count({ where: { companyId: ids.company } }),
      prisma.deal.count({ where: { companyId: ids.company } }),
    ]);
    expect(after).toEqual(before);
  });

  it('пишет событие журнала аудита о предпросмотре', async () => {
    const batchId = await createBatch();
    await bitrixImportProcessor(job('preview', batchId), prisma);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'bitrix_import_batch', entityId: batchId },
      select: { action: true, userId: true },
    });
    expect(audit).toMatchObject({ action: 'bitrix_import_previewed', userId: ids.user });
  });

  it('выключенный флаг останавливает пакет с понятной причиной (У-202)', async () => {
    process.env.FEATURE_BITRIX_MIGRATION = '0';
    resetIntegrationSettingsCache();
    const batchId = await createBatch();

    const result = await bitrixImportProcessor(job('preview', batchId), prisma);
    expect(result.status).toBe('failed');

    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true, errors: true },
    });
    expect(saved.status).toBe('failed');
    expect(JSON.stringify(saved.errors)).toContain('выключена');
  });

  it('откат ещё не включён — пакет говорит об этом, а не молчит', async () => {
    const batchId = await createBatch();
    const result = await bitrixImportProcessor(job('rollback', batchId), prisma);
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.reason).toContain('следующим шагом');
  });

  it('пакета нет — задача заканчивается без падения', async () => {
    const result = await bitrixImportProcessor(job('preview', 'нет-такого-пакета'), prisma);
    expect(result).toMatchObject({ status: 'skipped', reason: 'пакет не найден' });
  });

  it('источник недоступен — пакет переходит в «не удалось» с текстом причины', async () => {
    delete process.env.FAKE_BITRIX;
    const batchId = await createBatch();
    try {
      const result = await bitrixImportProcessor(job('preview', batchId), prisma);
      expect(result.status).toBe('failed');
      expect(result.reason).toContain('вебхук');
    } finally {
      process.env.FAKE_BITRIX = '1';
    }
  });
});

describe('bitrixImportProcessor — применение пакета', () => {
  // Применение пишет по-настоящему, а база у тестов общая: перед каждым
  // прогоном кабинет очищается, иначе второй тест видел бы данные первого.
  beforeEach(async () => {
    await wipeCompanyData();
  });

  it('применение переносит всё по критериям приёмки и заводит журнал', async () => {
    const batchId = await createBatch({ defaultManagerId: ids.user, tables: FULL_TABLES });

    const result = await bitrixImportProcessor(job('apply', batchId), prisma);
    expect(result).toMatchObject({ batchId, status: 'applied' });

    const saved = await prisma.bitrixImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true, appliedAt: true, errors: true, counts: true },
    });
    expect(saved.status).toBe('applied');
    expect(saved.appliedAt).not.toBeNull();
    expect(saved.errors).toEqual([]);

    const [organizations, contacts, channels, leads, deals, tasks, orders] = await Promise.all([
      prisma.organization.count({ where: { companyId: ids.company } }),
      prisma.contact.count({ where: { companyId: ids.company } }),
      prisma.contactChannel.count({ where: { companyId: ids.company } }),
      prisma.lead.count({ where: { createdByUserId: ids.user } }),
      prisma.deal.count({ where: { companyId: ids.company } }),
      prisma.task.count({ where: { companyId: ids.company } }),
      prisma.order.count({ where: { companyId: ids.company } }),
    ]);
    // Числа фикстуры портала (спека §10): перенеслось всё, что там есть.
    expect({ organizations, contacts, leads, deals, tasks }).toEqual({
      organizations: 5,
      contacts: 8,
      leads: 6,
      deals: 6,
      tasks: 4,
    });
    expect(channels).toBeGreaterThan(0);
    // Две выигранные сделки просят заказ; в чистой базе оба заводятся сами.
    expect(orders).toBe(2);

    const wonOrder = await prisma.order.findFirstOrThrow({
      where: { companyId: ids.company, externalId: 'bitrix:deal:401' },
      select: { id: true, executionStatus: true, financialStatus: true, statusChanges: true },
    });
    expect(wonOrder.executionStatus).toBe('completed');
    // Деньги считает 1С — заказ-история приходит без оплаты (`В-2-3`).
    expect(wonOrder.financialStatus).toBe('not_billed');
    expect(wonOrder.statusChanges.length).toBeGreaterThan(0);

    // Заметка сохраняет дату оригинала и живёт без автора («Импорт из Битрикс24»).
    const note = await prisma.dealNote.findFirstOrThrow({
      where: { deal: { companyId: ids.company, bitrixId: '401' } },
      select: { createdAt: true, authorId: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(note.createdAt.getUTCFullYear()).toBe(2025);

    const journal = await prisma.bitrixImportWrite.count({ where: { batchId } });
    expect(journal).toBeGreaterThan(20);
  });

  it('повторное применение не плодит дублей и не трогает правленное человеком', async () => {
    const first = await createBatch({ defaultManagerId: ids.user, tables: FULL_TABLES });
    await bitrixImportProcessor(job('apply', first), prisma);

    const org = await prisma.organization.findFirstOrThrow({
      where: { companyId: ids.company, bitrixId: '101' },
      select: { id: true },
    });
    await prisma.organization.update({
      where: { id: org.id },
      data: { name: 'Название, поправленное человеком' },
    });
    const before = await snapshotCounts();

    const second = await createBatch({ defaultManagerId: ids.user, tables: FULL_TABLES });
    await bitrixImportProcessor(job('apply', second), prisma);

    expect(await snapshotCounts()).toEqual(before);
    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { name: true },
    });
    expect(after.name).toBe('Название, поправленное человеком');

    const settings = (
      await prisma.bitrixImportBatch.findUniqueOrThrow({
        where: { id: second },
        select: { settings: true },
      })
    ).settings as BatchSettings;
    const kept = (settings.rows ?? []).filter((r) => (r.reason ?? '').includes('ручное'));
    expect(kept.length).toBeGreaterThan(0);
  });
});
