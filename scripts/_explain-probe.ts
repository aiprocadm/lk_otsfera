/**
 * Track F: EXPLAIN ANALYZE probe for the three key hot queries (before/after
 * the F1/F2 index migrations). Seeds synthetic volume first (small tables never
 * pick an index — the planner is right to seq-scan them), prints plans, and
 * removes its synthetic rows unless --keep.
 *
 *   tsx scripts/_explain-probe.ts seed     # create marker user + bulk rows
 *   tsx scripts/_explain-probe.ts explain  # run the three EXPLAIN ANALYZE
 *   tsx scripts/_explain-probe.ts clean    # delete synthetic rows
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MARK = 'f-explain-probe';
const EMAIL = `${MARK}@probe.local`;

async function seed() {
  const company = await prisma.company.upsert({
    where: { id: MARK + '-company' },
    update: {},
    create: { id: MARK + '-company', name: MARK },
  });
  const org = await prisma.organization.upsert({
    where: { id: MARK + '-org' },
    update: {},
    create: { id: MARK + '-org', name: MARK, companyId: company.id },
  });
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      id: MARK + '-user',
      email: EMAIL,
      passwordHash: 'x',
      name: MARK,
      role: 'manager',
      companyId: company.id,
    },
  });

  const B = 5000;
  // 50k AuditLog rows across a spread of entities/entityIds
  for (let batch = 0; batch < 10; batch++) {
    await prisma.auditLog.createMany({
      data: Array.from({ length: B }, (_, i) => ({
        action: 'order_status_changed',
        entity: ['order', 'commission_statement', 'organization'][i % 3],
        entityId: `${MARK}-e${(batch * B + i) % 4000}`,
        userId: user.id,
        createdAt: new Date(Date.now() - ((batch * B + i) % 90) * 86400000),
      })),
    });
  }
  // 20k orders in one company (the C8 company-wide list shape)
  for (let batch = 0; batch < 4; batch++) {
    await prisma.order.createMany({
      data: Array.from({ length: B }, (_, i) => ({
        title: MARK,
        companyId: company.id,
        organizationId: org.id,
        executionStatus: (['pending', 'in_progress', 'completed'] as const)[i % 3],
        financialStatus: (['billed', 'paid'] as const)[i % 2],
      })),
    });
  }
  // 30k notifications for one user
  for (let batch = 0; batch < 6; batch++) {
    await prisma.notification.createMany({
      data: Array.from({ length: B }, (_, i) => ({
        userId: user.id,
        type: 'x',
        title: MARK,
        body: 'x',
        isRead: i % 5 !== 0,
        createdAt: new Date(Date.now() - ((batch * B + i) % 60) * 86400000),
      })),
    });
  }
  console.log('seeded: 50k AuditLog, 20k Order, 30k Notification');
}

async function analyzeTables(db: { $executeRawUnsafe: (q: string) => Promise<unknown> }) {
  for (const t of ['AuditLog', 'Order', 'Notification']) {
    await db.$executeRawUnsafe(`ANALYZE "${t}"`);
  }
}

const NEW_INDEXES = [
  'AuditLog_entity_entityId_idx',
  'AuditLog_userId_createdAt_idx',
  'AuditLog_createdAt_idx',
  'Order_companyId_executionStatus_idx',
  'Order_companyId_financialStatus_idx',
  'Notification_userId_createdAt_idx',
  'Notification_userId_isRead_idx',
];

/**
 * "Before" plans on the SAME data: drop the new indexes inside a transaction,
 * EXPLAIN, then roll back — nothing is persisted.
 */
async function explainBefore() {
  await analyzeTables(prisma);
  await prisma
    .$transaction(
      async (tx) => {
        for (const idx of NEW_INDEXES) {
          await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "${idx}"`);
        }
        await runExplains(tx);
        throw new Error('__rollback__'); // намеренно: откатить DROP INDEX
      },
      { timeout: 60000 }
    )
    .catch((e) => {
      if (!(e instanceof Error && e.message === '__rollback__')) throw e;
    });
}

async function runExplains(db: { $queryRawUnsafe: (q: string) => Promise<unknown> }) {
  const queries: Array<[string, string]> = [
    [
      'Q1 AuditLog entity+entityId (manager/orderDetail, admin statement audit)',
      `EXPLAIN ANALYZE SELECT * FROM "AuditLog" WHERE entity = 'order' AND "entityId" = '${MARK}-e77' ORDER BY "createdAt" DESC LIMIT 50`,
    ],
    [
      'Q2 Order companyId+executionStatus aggregate (manager KPIs count, leader groupBy)',
      `EXPLAIN ANALYZE SELECT count(*) FROM "Order" WHERE "companyId" = '${MARK}-company' AND "executionStatus" = 'pending'`,
    ],
    [
      'Q3 Notification userId ORDER BY createdAt (api/notifications feed)',
      `EXPLAIN ANALYZE SELECT id FROM "Notification" WHERE "userId" = '${MARK}-user' ORDER BY "createdAt" DESC LIMIT 50`,
    ],
  ];
  for (const [label, sql] of queries) {
    console.log(`\n===== ${label} =====`);
    const rows = (await db.$queryRawUnsafe(sql)) as Array<{ 'QUERY PLAN': string }>;
    for (const r of rows) console.log(r['QUERY PLAN']);
  }
}

async function explain() {
  await analyzeTables(prisma);
  await runExplains(prisma);
}

async function clean() {
  await prisma.auditLog.deleteMany({ where: { entityId: { startsWith: MARK } } });
  await prisma.notification.deleteMany({ where: { title: MARK } });
  await prisma.order.deleteMany({ where: { title: MARK } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.organization.deleteMany({ where: { id: MARK + '-org' } });
  await prisma.company.deleteMany({ where: { id: MARK + '-company' } });
  console.log('cleaned');
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'seed') await seed();
  else if (cmd === 'explain') await explain();
  else if (cmd === 'before') await explainBefore();
  else if (cmd === 'clean') await clean();
  else throw new Error('usage: seed | before | explain | clean');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
