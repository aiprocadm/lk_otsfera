'use server';

import { revalidatePath } from 'next/cache';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { setOrgRequisites } from '@/lib/services/organization/requisites';
import { setPartnerRequisites } from '@/lib/services/partner/requisites';
import { setCompanyRequisites } from '@/lib/services/admin/companyRequisites';
import {
  setOrgRequisitesByAdmin,
  setPartnerRequisitesByAdmin,
} from '@/lib/services/admin/counterpartyRequisites';
import type { RequisitesInput } from '@/lib/requisites/validate';

/**
 * Этап 8 (ФТ-9.2, PR-1) — server-actions форм реквизитов. Тонкие адаптеры §3:
 * гейты ролей/подролей энфорсят сервисы.
 */

export type RequisitesActionResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] };

function requisitesInput(fd: FormData): RequisitesInput {
  const f = (k: string) => str(fd, k) || null;
  return {
    legalName: f('legalName'),
    inn: f('inn'),
    kpp: f('kpp'),
    ogrn: f('ogrn'),
    legalAddress: f('legalAddress'),
    bankName: f('bankName'),
    bankAccount: f('bankAccount'),
    corrAccount: f('corrAccount'),
    bic: f('bic'),
    signerName: f('signerName'),
    signerPosition: f('signerPosition'),
    signerBasis: f('signerBasis'),
  };
}

export async function setOrgRequisitesAction(fd: FormData): Promise<RequisitesActionResult> {
  const session = await requireSession();
  const orgId = str(fd, 'orgId');
  if (!orgId) return { ok: false, error: 'validation' };
  const res = await setOrgRequisites(prisma, session, orgId, requisitesInput(fd));
  if (!res.ok) return res;
  revalidatePath('/organization/settings');
  return { ok: true };
}

export async function setPartnerRequisitesAction(fd: FormData): Promise<RequisitesActionResult> {
  const session = await requireSession();
  const res = await setPartnerRequisites(prisma, session, requisitesInput(fd));
  if (!res.ok) return res;
  revalidatePath('/partner/settings');
  return { ok: true };
}

export async function setCompanyRequisitesAction(fd: FormData): Promise<RequisitesActionResult> {
  const session = await requireSession();
  const companyId = str(fd, 'companyId');
  if (!companyId) return { ok: false, error: 'validation' };
  const res = await setCompanyRequisites(prisma, session, companyId, {
    ...requisitesInput(fd),
    phone: str(fd, 'phone') || null,
    email: str(fd, 'email') || null,
  });
  if (!res.ok) return res;
  revalidatePath('/admin/settings');
  return { ok: true };
}

export async function setOrgRequisitesByAdminAction(fd: FormData): Promise<RequisitesActionResult> {
  const session = await requireSession();
  const orgId = str(fd, 'orgId');
  if (!orgId) return { ok: false, error: 'validation' };
  const res = await setOrgRequisitesByAdmin(prisma, session, orgId, requisitesInput(fd));
  if (!res.ok) return res;
  revalidatePath(`/admin/organizations/${orgId}`);
  return { ok: true };
}

export async function setPartnerRequisitesByAdminAction(
  fd: FormData
): Promise<RequisitesActionResult> {
  const session = await requireSession();
  const partnerId = str(fd, 'partnerId');
  if (!partnerId) return { ok: false, error: 'validation' };
  const res = await setPartnerRequisitesByAdmin(prisma, session, partnerId, requisitesInput(fd));
  if (!res.ok) return res;
  revalidatePath(`/admin/partners/${partnerId}`);
  return { ok: true };
}
