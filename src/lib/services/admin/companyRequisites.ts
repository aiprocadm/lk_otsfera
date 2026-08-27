import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import {
  validateRequisites,
  type RequisitesInput,
  type RequisitesValues,
} from '@/lib/requisites/validate';
import { parseDocumentNumbering, type DocumentNumbering } from './companyBranding';

/**
 * Этап 8 (ФТ-9.2, PR-1) — реквизиты Company (исполнитель). Только admin
 * (Model A, /admin/settings). Company выбирается явно (компаний может быть
 * несколько); дополнительно phone/email для шапки документов.
 */

export type CompanyRequisites = RequisitesValues & {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  // `У-138`: налоги и нумерация — блоки того же экрана «Реквизиты исполнителя».
  defaultVatRate: string | null;
  pricesIncludeVat: boolean;
  numbering: DocumentNumbering | null;
};

const REQ_SELECT = {
  id: true,
  name: true,
  legalName: true,
  inn: true,
  kpp: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true,
  phone: true,
  email: true,
  defaultVatRate: true,
  pricesIncludeVat: true,
  documentNumbering: true,
} as const;

export async function listCompaniesRequisites(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; companies: CompanyRequisites[] } | { ok: false; error: 'forbidden' }> {
  // `У-135` (решение `Р-22`): реквизиты исполнителя правит и руководитель —
  // но только своей компании. Админ видит все.
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  const rows = await prisma.company.findMany({
    // Sentinel-скоуп: руководитель без компании не видит НИЧЕГО, а не всё —
    // `undefined` в where снял бы фильтр целиком (та же грабля, что в C8).
    where: session.role === 'leader' ? { id: session.companyId ?? '__none__' } : {},
    select: REQ_SELECT,
    orderBy: { name: 'asc' },
    take: 50,
  });
  const companies = rows.map(({ defaultVatRate, documentNumbering, ...rest }) => ({
    ...rest,
    // Decimal через границу не проходит; кривой JSON нумерации = «нет настроек».
    defaultVatRate: defaultVatRate == null ? null : defaultVatRate.toFixed(4),
    numbering: parseDocumentNumbering(documentNumbering),
  }));
  return { ok: true, companies };
}

export async function setCompanyRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: RequisitesInput & { phone?: string | null; email?: string | null }
): Promise<
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] }
> {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  // `У-135`: руководитель меняет ТОЛЬКО свою компанию. Сравнение, а не тихая
  // подмена: чужой id из формы — это ошибка вызова, и её надо видеть.
  if (session.role === 'leader' && companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  const validated = validateRequisites(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'validation', messages: [`Некорректный email «${email}»`] };
  }

  const before = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!before) return { ok: false, error: 'not_found' };

  await prisma.company.update({ where: { id: companyId }, data: { ...v, phone, email } });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_changed',
    entity: 'company',
    entityId: companyId,
    after: {
      inn: v.inn,
      kpp: v.kpp,
      ogrn: v.ogrn,
      bic: v.bic,
      bankAccountTail: v.bankAccount?.slice(-4) ?? null,
    },
  });
  return { ok: true };
}
