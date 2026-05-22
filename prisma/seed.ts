import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db/prisma';
import { uploadLeadAttachment } from '../src/lib/services/partner/leadAttachments';
import { calculateStatementForPartner } from '../src/lib/services/commission/statement';

async function main() {
  const company = await prisma.company.upsert({
    where: { id: 'demo-company' },
    update: {},
    create: { id: 'demo-company', name: 'Demo LLC' }
  });

  const passwordHash = await bcrypt.hash('Password123!', 10);

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
    where: { slug: 'demo-partner' },
    update: {},
    create: { name: 'Demo Partner', legalName: 'OOO Demo Partner', slug: 'demo-partner' }
  });

  const partnerUser = await prisma.user.upsert({
    where: { email: 'partner@demo.local' },
    update: { partnerId: partner.id, role: 'partner' },
    create: {
      email: 'partner@demo.local',
      name: 'Partner Demo',
      passwordHash,
      role: 'partner',
      partnerId: partner.id
    }
  });

  await prisma.partnerUser.upsert({
    where: { partnerId_userId: { partnerId: partner.id, userId: partnerUser.id } },
    update: { roleInPartner: 'admin', isActive: true },
    create: {
      partnerId: partner.id,
      userId: partnerUser.id,
      roleInPartner: 'admin',
      assignedOrgIds: [],
      isActive: true
    }
  });

  const existingLeads = await prisma.lead.findMany({
    where: { partnerId: partner.id, createdByUserId: partnerUser.id },
    select: { id: true, subject: true, status: true, attachments: { select: { id: true } } }
  });

  const seedLeads: Array<{ subject: string; status: 'new' | 'in_review'; needsAttachments: boolean }> = [
    { subject: 'Запрос на обучение 12 человек — охрана труда', status: 'new', needsAttachments: false },
    { subject: 'Поставка СИЗ для строительной площадки', status: 'in_review', needsAttachments: true }
  ];

  const supabaseReady = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  for (const tmpl of seedLeads) {
    let lead = existingLeads.find((l) => l.subject === tmpl.subject);
    if (!lead) {
      const created = await prisma.lead.create({
        data: {
          partnerId: partner.id,
          createdByUserId: partnerUser.id,
          clientCompanyName: tmpl.subject.startsWith('Поставка') ? 'StroyMontazh LLC' : 'EduCorp LLC',
          clientInn: tmpl.subject.startsWith('Поставка') ? '7715123456' : '7707000123',
          clientContactName: 'Иван Иванов',
          clientContactPhone: '+7 (495) 000-00-00',
          subject: tmpl.subject,
          estimatedAmount: tmpl.subject.startsWith('Поставка') ? 850000 : 240000,
          productType: tmpl.subject.startsWith('Поставка') ? ['supply'] : ['training'],
          status: tmpl.status,
          notes: 'Демо-заявка, создана seed.ts'
        }
      });
      lead = { id: created.id, subject: created.subject, status: created.status, attachments: [] };
      console.log(`[seed] created lead ${lead.id} (${lead.status})`);
    }

    if (!tmpl.needsAttachments) continue;
    if (lead.attachments.length > 0) {
      console.log(`[seed] lead ${lead.id} already has ${lead.attachments.length} attachments — skip upload`);
      continue;
    }
    if (!supabaseReady) {
      console.log(
        `[seed] SUPABASE_URL/SERVICE_ROLE_KEY not set — skipping attachment upload for lead ${lead.id}`
      );
      continue;
    }

    const fixturesDir = join(process.cwd(), 'prisma', 'seed-fixtures', 'lead-attachments');
    const fixtureFiles = ['sample-contract.pdf', 'sample-specification.pdf'];
    for (const filename of fixtureFiles) {
      const filepath = join(fixturesDir, filename);
      const buf = await readFile(filepath);
      try {
        const attachment = await uploadLeadAttachment(prisma, {
          leadId: lead.id,
          partnerId: partner.id,
          uploadedByUserId: partnerUser.id,
          file: {
            buffer: new Uint8Array(buf),
            name: filename,
            declaredMimeType: 'application/pdf',
            size: buf.byteLength
          }
        });
        console.log(`[seed] uploaded attachment ${attachment.id} (${filename}) for lead ${lead.id}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[seed] failed to upload ${filename} for lead ${lead.id}: ${msg}`);
      }
    }
  }

  // ─── Demo: paid order + commission statement for prev month ─────────
  const demoOrg = await prisma.organization.upsert({
    where: { id: 'demo-org-commission' },
    update: {},
    create: {
      id: 'demo-org-commission',
      name: 'Demo Org (комиссия)',
      partnerId: partner.id,
      companyId: company.id
    }
  });

  const prevMonthFrom = new Date();
  prevMonthFrom.setDate(1);
  prevMonthFrom.setMonth(prevMonthFrom.getMonth() - 1);
  prevMonthFrom.setHours(0, 0, 0, 0);

  const prevMonthTo = new Date(prevMonthFrom.getFullYear(), prevMonthFrom.getMonth() + 1, 0, 23, 59, 59, 999);

  const demoOrder = await prisma.order.upsert({
    where: { id: 'demo-order-commission' },
    update: {},
    create: {
      id: 'demo-order-commission',
      externalId: 'DEMO-COMM-001',
      orderNumber: 'DEMO-COMM-001',
      title: 'Демо-заказ для комиссии',
      companyId: company.id,
      partnerId: partner.id,
      totalAmount: 100000,
      vatIncluded: true,
      vatRate: 0.2,
      financialStatus: 'paid',
      executionStatus: 'completed',
      closedAt: new Date(prevMonthFrom.getFullYear(), prevMonthFrom.getMonth(), 15)
    }
  });
  void demoOrg; // org was created for completeness but Order links to Company
  console.log(`[seed] demo paid order: ${demoOrder.id}`);

  const existingStatement = await prisma.commissionStatement.findFirst({
    where: {
      partnerId: partner.id,
      periodFrom: prevMonthFrom,
      periodTo: prevMonthTo,
      supersededBy: null
    }
  });

  if (!existingStatement) {
    const { statement, itemCount } = await calculateStatementForPartner(prisma, {
      partnerId: partner.id,
      periodFrom: prevMonthFrom,
      periodTo: prevMonthTo,
      calculatedByUserId: null
    });
    console.log(`[seed] created commission statement ${statement.id} with ${itemCount} items`);
  } else {
    console.log(`[seed] commission statement already exists: ${existingStatement.id}`);
  }

  console.log('[seed] done');
}

main()
  .catch((e) => {
    console.error('[seed] error', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
