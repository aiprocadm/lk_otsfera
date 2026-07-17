import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { backfillContacts } from '@/lib/services/contacts/backfill';

const prisma = new PrismaClient();
const STAMP = `m2bf${Date.now()}`;
afterAll(async () => {
  await prisma.contactChannel.deleteMany({ where: { value: { startsWith: STAMP } } });
  await prisma.contact.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: STAMP } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: STAMP } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
});

describe('backfillContacts', () => {
  it('seeds contacts from org-role Users and Leads; dedups by channel; is idempotent', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: co.id } });
    await prisma.user.create({ data: { email: `${STAMP}-u@t.local`, name: `${STAMP}-User`, role: 'organization', organizationId: org.id, whatsappPhone: '+79990007777' } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-p` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-c@t.local`, name: 'C', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({ data: { partnerId: partner.id, createdByUserId: creator.id, organizationId: org.id, clientCompanyName: `${STAMP}-Lead`, clientContactName: `${STAMP}-Контакт`, clientContactPhone: '+79990007777', subject: 's' } });

    const first = await backfillContacts(prisma);
    expect(first.contactsCreated).toBeGreaterThanOrEqual(1);
    const chans = await prisma.contactChannel.findMany({ where: { companyId: co.id, normalizedValue: '+79990007777' } });
    expect(chans).toHaveLength(1);

    const second = await backfillContacts(prisma);
    expect(second.contactsCreated).toBe(0);
  });

  it('user with telegram/max chat ids seeds both channel types; a blank chatId is skipped (ensureChannel !nv); a channel already claimed by another contact is not duplicated onto the new one', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coU2` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-orgU2`, companyId: co.id } });
    // Pre-existing contact/channel for the SAME email the new user will have —
    // simulates the email already being claimed, so ensureChannel must hit its
    // internal `seen.has(...)` no-op (backfill.ts line 35), not duplicate it.
    const priorContact = await prisma.contact.create({ data: { companyId: co.id, name: `${STAMP}-PriorOwner` } });
    await prisma.contactChannel.create({
      data: { contactId: priorContact.id, companyId: co.id, type: 'email', value: `${STAMP}-shared@t.local`, normalizedValue: `${STAMP}-shared@t.local` },
    });
    await prisma.user.create({
      data: {
        email: `${STAMP}-shared@t.local`, name: `${STAMP}-U2`, role: 'organization', organizationId: org.id,
        whatsappPhone: '+79990002020', telegramChatId: `${STAMP}-tg2`, maxChatId: '\t \t', // blank after trim → ensureChannel !nv early-return
      },
    });

    const res = await backfillContacts(prisma);
    expect(res.contactsCreated).toBeGreaterThanOrEqual(1);
    const created = await prisma.contact.findFirst({ where: { companyId: co.id, name: { not: `${STAMP}-PriorOwner` } }, include: { channels: true } });
    const types = created!.channels.map((c) => c.type).sort();
    expect(types).toEqual(['telegram', 'whatsapp']); // max skipped (blank), email skipped (already claimed elsewhere)
    // The pre-existing email channel is still the ONLY one for that address — not duplicated.
    const emailChans = await prisma.contactChannel.findMany({ where: { companyId: co.id, normalizedValue: `${STAMP}-shared@t.local` } });
    expect(emailChans).toHaveLength(1);
    expect(emailChans[0].contactId).toBe(priorContact.id);
  });

  it('a Lead with no organizationId is skipped (org-less leads cannot be scoped to a company)', async () => {
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-pOrgless` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-orglessCreator@t.local`, name: 'C2', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({
      data: { partnerId: partner.id, createdByUserId: creator.id, clientCompanyName: `${STAMP}-OrglessLead`, clientContactName: `${STAMP}-OrglessContact`, clientContactPhone: '+79990003030', subject: 's' },
    });
    const before = await prisma.contact.count();
    await backfillContacts(prisma);
    const after = await prisma.contact.count();
    expect(after).toBe(before); // skipped: no organization → no companyId to scope the contact to
  });

  it('a fresh Lead (email + phone, neither previously seen) creates a NEW contact with both channels', async () => {
    const co = await prisma.company.create({ data: { name: `${STAMP}-coLeadFresh` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-orgLeadFresh`, companyId: co.id } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-pFresh` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-freshCreator@t.local`, name: 'C3', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({
      data: {
        partnerId: partner.id, createdByUserId: creator.id, organizationId: org.id,
        clientCompanyName: `${STAMP}-FreshLead`, clientContactName: `${STAMP}-FreshContact`,
        clientContactPhone: '+79990004040', clientContactEmail: `${STAMP}-fresh@t.local`, subject: 's',
      },
    });

    const res = await backfillContacts(prisma);
    expect(res.contactsCreated).toBeGreaterThanOrEqual(1);
    const contact = await prisma.contact.findFirst({ where: { companyId: co.id, name: `${STAMP}-FreshContact` }, include: { channels: true } });
    expect(contact).not.toBeNull();
    const types = contact!.channels.map((c) => c.type).sort();
    expect(types).toEqual(['email', 'phone']);
  });

  it('a Lead with a blank clientContactName falls back to the default "Контакт" name', async () => {
    // Contact.companyId FK cascades from Company (onDelete: Cascade) — the resulting
    // contact isn't STAMP-named (it's literally "Контакт"), so cleanup relies on the
    // company-scoped cascade in afterAll rather than the name-prefix delete.
    const co = await prisma.company.create({ data: { name: `${STAMP}-coBlankName` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-orgBlankName`, companyId: co.id } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-pBlankName` } });
    const creator = await prisma.user.create({ data: { email: `${STAMP}-blankNameCreator@t.local`, name: 'C4', role: 'partner', partnerId: partner.id } });
    await prisma.lead.create({
      data: {
        partnerId: partner.id, createdByUserId: creator.id, organizationId: org.id,
        clientCompanyName: `${STAMP}-BlankNameLead`, clientContactName: '',
        clientContactPhone: '+79990005050', subject: 's',
      },
    });

    await backfillContacts(prisma);
    const contact = await prisma.contact.findFirst({ where: { companyId: co.id } });
    expect(contact?.name).toBe('Контакт');
  });
});
