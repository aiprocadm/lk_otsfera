import type { Job } from 'bullmq';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db/prisma';
import { resetOneCAdapter } from '../src/lib/services/oneCSync';
import { syncOrganizationsProcessor } from '../src/worker/processors/sync-organizations';
import { syncOrdersProcessor } from '../src/worker/processors/sync-orders';
import { syncPaymentsProcessor } from '../src/worker/processors/sync-payments';
import { syncDocumentsProcessor } from '../src/worker/processors/sync-documents';
import type { SyncJobPayload } from '../src/lib/jobs/types';

const PARTNER_SLUG = '1c-partner-001';
const PASSWORD = 'Password123!';

function fakeJob(): Job<SyncJobPayload> {
  return {
    id: 'seed-' + Date.now(),
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const }
  } as Job<SyncJobPayload>;
}

async function main() {
  process.env.ONE_C_ADAPTER = 'fake';
  resetOneCAdapter();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const company = await prisma.company.upsert({
    where: { id: 'demo-company' },
    update: {},
    create: { id: 'demo-company', name: 'Demo LLC' }
  });
  await prisma.user.upsert({
    where: { email: 'admin@demo.local' },
    update: {},
    create: {
      email: 'admin@demo.local',
      name: 'Admin',
      passwordHash,
      companyId: company.id,
      role: 'admin'
    }
  });

  const partner = await prisma.partner.upsert({
    where: { slug: PARTNER_SLUG },
    update: {},
    create: {
      name: 'ООО «Промтехносфера-Партнёр»',
      legalName: 'ООО «Промтехносфера-Партнёр»',
      slug: PARTNER_SLUG,
      commissionRate: 0.1
    }
  });

  const partnerAdmin = await prisma.user.upsert({
    where: { email: 'partner@demo.local' },
    update: { partnerId: partner.id },
    create: {
      email: 'partner@demo.local',
      name: 'Partner Admin',
      passwordHash,
      role: 'partner',
      partnerId: partner.id
    }
  });
  await prisma.partnerUser.upsert({
    where: { partnerId_userId: { partnerId: partner.id, userId: partnerAdmin.id } },
    update: { isActive: true, roleInPartner: 'admin', assignedOrgIds: [] },
    create: {
      partnerId: partner.id,
      userId: partnerAdmin.id,
      roleInPartner: 'admin',
      assignedOrgIds: [],
      isActive: true
    }
  });

  const job = fakeJob();
  const orgsResult = await syncOrganizationsProcessor(job);
  const ordersResult = await syncOrdersProcessor(job);
  const paymentsResult = await syncPaymentsProcessor(job);
  const documentsResult = await syncDocumentsProcessor(job);

  const firstOrg = await prisma.organization.findFirst({
    where: { partnerId: partner.id, externalId: '1c-org-001' },
    select: { id: true }
  });
  const managerScope = firstOrg ? [firstOrg.id] : [];

  const partnerManager = await prisma.user.upsert({
    where: { email: 'partner-mgr@demo.local' },
    update: { partnerId: partner.id },
    create: {
      email: 'partner-mgr@demo.local',
      name: 'Partner Manager',
      passwordHash,
      role: 'partner',
      partnerId: partner.id
    }
  });
  await prisma.partnerUser.upsert({
    where: { partnerId_userId: { partnerId: partner.id, userId: partnerManager.id } },
    update: { isActive: true, roleInPartner: 'manager', assignedOrgIds: managerScope },
    create: {
      partnerId: partner.id,
      userId: partnerManager.id,
      roleInPartner: 'manager',
      assignedOrgIds: managerScope,
      isActive: true
    }
  });

  console.log('[seed] sync results', {
    orgs: orgsResult,
    orders: ordersResult,
    payments: paymentsResult,
    documents: documentsResult
  });
  console.log('[seed] demo accounts (password = ' + PASSWORD + '):');
  console.log('  - admin@demo.local (role=admin)');
  console.log('  - partner@demo.local (partner admin, sees all orgs)');
  console.log('  - partner-mgr@demo.local (partner manager, scope=' + managerScope.length + ' org)');
}

main()
  .catch((err) => {
    console.error('[seed] error', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
