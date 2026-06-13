import type { Job } from 'bullmq';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db/prisma';
import { resetOneCAdapter } from '../src/lib/services/oneCSync';
import { syncOrganizationsProcessor } from '../src/worker/processors/sync-organizations';
import { syncOrdersProcessor } from '../src/worker/processors/sync-orders';
import { syncPaymentsProcessor } from '../src/worker/processors/sync-payments';
import { syncDocumentsProcessor } from '../src/worker/processors/sync-documents';
import { calculateStatementForPartner } from '../src/lib/services/commission/statement';
import { recordAudit } from '../src/lib/auth/audit';
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
  const admin = await prisma.user.upsert({
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
    select: { id: true, companyId: true }
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

  // ─── Demo: paid order + commission statement for prev month ─────────
  const prevMonthFrom = new Date();
  prevMonthFrom.setDate(1);
  prevMonthFrom.setMonth(prevMonthFrom.getMonth() - 1);
  prevMonthFrom.setHours(0, 0, 0, 0);

  const prevMonthTo = new Date(prevMonthFrom.getFullYear(), prevMonthFrom.getMonth() + 1, 0, 23, 59, 59, 999);

  if (!firstOrg) {
    throw new Error('[seed] expected firstOrg to be populated by sync-organizations — cannot attach demo commission order');
  }
  if (!firstOrg.companyId) {
    throw new Error('[seed] firstOrg has no companyId — leader/manager company-wide scope would be empty');
  }
  // Единая компания для заказов, менеджера и руководителя: синканные заказы и orgs
  // живут в компании firstOrg (sync-organizations создаёт по компании на org), а
  // company-wide выборки лидера фильтруют по этому companyId.
  const demoCompanyId = firstOrg.companyId;

  await prisma.order.upsert({
    where: { id: 'demo-order-commission' },
    update: {},
    create: {
      id: 'demo-order-commission',
      externalId: 'DEMO-COMM-001',
      orderNumber: 'DEMO-COMM-001',
      title: 'Демо-заказ для комиссии',
      companyId: demoCompanyId,
      partnerId: partner.id,
      organizationId: firstOrg.id,
      totalAmount: 100000,
      vatIncluded: true,
      vatRate: 0.2,
      financialStatus: 'paid',
      executionStatus: 'completed',
      closedAt: new Date(prevMonthFrom.getFullYear(), prevMonthFrom.getMonth(), 15)
    }
  });

  const existingStatement = await prisma.commissionStatement.findFirst({
    where: {
      partnerId: partner.id,
      periodFrom: prevMonthFrom,
      periodTo: prevMonthTo,
      supersededBy: null
    }
  });

  let demoStatementId: string;
  if (!existingStatement) {
    const { statement, itemCount } = await calculateStatementForPartner(prisma, {
      partnerId: partner.id,
      periodFrom: prevMonthFrom,
      periodTo: prevMonthTo,
      calculatedByUserId: null
    });
    demoStatementId = statement.id;
    console.log(`[seed] created commission statement ${statement.id} with ${itemCount} items`);
  } else {
    demoStatementId = existingStatement.id;
    console.log(`[seed] commission statement already exists: ${existingStatement.id}`);
  }

  // ─── Demo: organization admin user (for e2e + manual smoke) ──────────
  if (firstOrg) {
    const orgAdmin = await prisma.user.upsert({
      where: { email: 'org@demo.local' },
      update: { role: 'organization', isActive: true, passwordHash, name: 'Organization Admin' },
      create: {
        email: 'org@demo.local',
        name: 'Organization Admin',
        passwordHash,
        role: 'organization'
      }
    });
    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: firstOrg.id, userId: orgAdmin.id } },
      update: { isActive: true, roleInOrg: 'admin' },
      create: {
        organizationId: firstOrg.id,
        userId: orgAdmin.id,
        roleInOrg: 'admin',
        isActive: true
      }
    });
  }

  // ─── Demo: manager user assigned to firstOrg (for e2e + manual smoke) ──
  // companyId привязан к компании firstOrg — иначе менеджер не попадёт в ростер
  // руководителя (listCompanyManagers фильтрует по User.companyId).
  if (firstOrg) {
    const managerUser = await prisma.user.upsert({
      where: { email: 'manager@demo.local' },
      update: { role: 'manager', isActive: true, passwordHash, name: 'Demo Manager', companyId: demoCompanyId },
      create: {
        email: 'manager@demo.local',
        name: 'Demo Manager',
        passwordHash,
        role: 'manager',
        companyId: demoCompanyId
      }
    });
    await prisma.organizationManager.upsert({
      where: {
        organizationId_userId: { organizationId: firstOrg.id, userId: managerUser.id }
      },
      update: { isActive: true, deactivatedAt: null },
      create: {
        organizationId: firstOrg.id,
        userId: managerUser.id,
        isActive: true
      }
    });
  }

  // ─── Demo: manager-leader (кнопка «Руководитель» на /login) ─────────
  // ВАЖНО: companyId обязателен — company-wide scope лидера выводится из него
  // (companyId=null деградирует в deny/скоуп, см. managerPolicy). Привязываем к
  // компании firstOrg — там живут синканные заказы и orgs, иначе кабинет пуст.
  if (firstOrg) {
    await prisma.user.upsert({
      where: { email: 'leader@demo.local' },
      update: { role: 'manager', managerRole: 'leader', isActive: true, passwordHash, name: 'Demo Leader', companyId: demoCompanyId },
      create: {
        email: 'leader@demo.local',
        name: 'Demo Leader',
        passwordHash,
        role: 'manager',
        managerRole: 'leader',
        companyId: demoCompanyId
      }
    });
  }

  // ─── Demo: student user (для кнопки «Студент» на /login) ────────────
  await prisma.user.upsert({
    where: { email: 'student@demo.local' },
    update: { role: 'student', isActive: true, passwordHash, name: 'Demo Student' },
    create: {
      email: 'student@demo.local',
      name: 'Demo Student',
      passwordHash,
      role: 'student'
    }
  });

  // ─── Admin-facing fixtures (6.7): norate partner, org rate override, audit sample ──
  // A second partner with commissionRate = 0 powers the dashboard "Партнёры без
  // ставки" attention item and the /admin/partners?filter=norate filter. Fixed id
  // so the admin-partners edit e2e snapshot can navigate to it deterministically.
  const noRatePartner = await prisma.partner.upsert({
    where: { slug: 'demo-partner-norate' },
    update: { commissionRate: 0, isActive: true },
    create: {
      id: 'demo-partner-norate',
      name: 'ООО «Демо-Партнёр без ставки»',
      legalName: 'ООО «Демо-Партнёр без ставки»',
      slug: 'demo-partner-norate',
      commissionRate: 0,
      isActive: true
    }
  });

  // One organization carries an explicit partner-commission-rate override so the
  // admin org-edit page (and its e2e snapshot) renders the override block.
  if (firstOrg) {
    await prisma.organization.update({
      where: { id: firstOrg.id },
      data: {
        partnerCommissionRate: 0.15,
        partnerCommissionRateNote: 'Индивидуальная ставка для демо-организации',
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: admin.id
      }
    });
  }

  // A spread of audit entries across entities/actions so the /admin/audit viewer
  // and the dashboard events feed have content. Guarded by a sentinel lookup so
  // re-running the seed doesn't pile up duplicates (recordAudit always inserts).
  const demoAuditSeeded = await prisma.auditLog.findFirst({
    where: { action: 'partner_created', entity: 'partner', entityId: noRatePartner.id }
  });
  if (!demoAuditSeeded) {
    const auditSamples: Array<Parameters<typeof recordAudit>[1]> = [
      {
        userId: admin.id,
        action: 'partner_created',
        entity: 'partner',
        entityId: noRatePartner.id,
        after: { name: noRatePartner.name, commissionRate: '0' }
      },
      {
        userId: admin.id,
        action: 'partner_commission_rate_changed',
        entity: 'partner',
        entityId: partner.id,
        before: { commissionRate: '0.05' },
        after: { commissionRate: '0.10' }
      },
      {
        userId: admin.id,
        action: 'organization_rate_override',
        entity: 'organization',
        entityId: firstOrg.id,
        after: { partnerCommissionRate: '0.15' }
      },
      {
        userId: admin.id,
        action: 'user_role_changed',
        entity: 'user',
        entityId: partnerManager.id,
        before: { role: 'student' },
        after: { role: 'partner' }
      },
      {
        userId: admin.id,
        action: 'commission_statement_approved',
        entity: 'commission_statement',
        entityId: demoStatementId
      }
    ];
    for (const rec of auditSamples) {
      await recordAudit(prisma, rec);
    }
    console.log(`[seed] inserted ${auditSamples.length} demo audit-log entries`);
  }

  console.log('[seed] demo accounts (password = ' + PASSWORD + '):');
  console.log('  - admin@demo.local (role=admin)');
  console.log('  - partner@demo.local (partner admin, sees all orgs)');
  console.log('  - partner-mgr@demo.local (partner manager, scope=' + managerScope.length + ' org)');
  console.log('  - org@demo.local (organization admin, membership in firstOrg)');
  console.log('  - manager@demo.local (cabinet manager, assigned to firstOrg)');
  console.log('  - leader@demo.local (manager-leader, company-wide)');
  console.log('  - student@demo.local (role=student, лендинг /student)');
  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] error', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
