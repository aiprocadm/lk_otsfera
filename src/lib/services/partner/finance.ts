import { Prisma, type PrismaClient, type CommissionStatement } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

export type FinanceKpis = {
  earnedTotal: number;
  pendingTotal: number;
  paidTotal: number;
};

// RSC-safe DTO: Prisma.Decimal is a class instance and cannot cross the
// Server→Client component boundary (Next would throw "Decimal objects are not
// supported"). Mirror the DealRow pattern in partner/deals.ts — serialize the
// Decimal to a fixed-precision string at the service boundary so the page can
// hand it straight to the client list.
export type StatementListItem = {
  id: string;
  periodFrom: Date;
  periodTo: Date;
  status: CommissionStatement['status'];
  totalCommissionAmount: string;
  pdfPath: string | null;
  xlsxPath: string | null;
  itemCount: number;
};

export async function getFinanceKpis(
  prisma: PrismaClient,
  partnerId: string
): Promise<FinanceKpis> {
  const statements = await prisma.commissionStatement.findMany({
    where: { partnerId, supersededBy: null },
    select: { status: true, totalCommissionAmount: true },
  });

  // Деньги суммируем на Prisma.Decimal (фаза 5, аудит D1): накопление во
  // float даёт дрейф в копейках. В number конвертируем один раз на выходе
  // (DTO для RSC остаётся числовым).
  const zero = new Prisma.Decimal(0);
  let earnedTotal = zero;
  let pendingTotal = zero;
  let paidTotal = zero;

  for (const s of statements) {
    const amount = s.totalCommissionAmount;
    if (s.status === 'approved' || s.status === 'paid') earnedTotal = earnedTotal.plus(amount);
    if (s.status === 'draft' || s.status === 'approved') pendingTotal = pendingTotal.plus(amount);
    if (s.status === 'paid') paidTotal = paidTotal.plus(amount);
  }

  return {
    earnedTotal: earnedTotal.toNumber(),
    pendingTotal: pendingTotal.toNumber(),
    paidTotal: paidTotal.toNumber(),
  };
}

export type ListStatementsOptions = {
  partnerId: string;
  status?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
};

export async function listStatements(
  prisma: PrismaClient,
  opts: ListStatementsOptions
): Promise<StatementListItem[]> {
  const { partnerId, status, from, to, skip = 0, take = 20 } = opts;

  const where: Prisma.CommissionStatementWhereInput = {
    partnerId,
    supersededBy: null,
  };
  if (status) where.status = status as CommissionStatement['status'];
  if (from || to) {
    where.periodFrom = {};
    if (from) (where.periodFrom as Prisma.DateTimeFilter).gte = from;
    if (to) (where.periodFrom as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.commissionStatement.findMany({
    where,
    orderBy: { periodFrom: 'desc' },
    skip,
    take,
    select: {
      id: true,
      periodFrom: true,
      periodTo: true,
      status: true,
      totalCommissionAmount: true,
      pdfPath: true,
      xlsxPath: true,
      _count: { select: { items: true } },
    },
  });

  return rows.map(({ _count, totalCommissionAmount, ...s }) => ({
    ...s,
    totalCommissionAmount: totalCommissionAmount.toFixed(2),
    itemCount: _count.items,
  }));
}

export type StatementFileFormat = 'pdf' | 'xlsx';

export type StatementFilePathResult =
  { ok: true; path: string } | { ok: false; error: 'not_found' | 'not_generated' };

/**
 * Путь к сгенерированному файлу акта (pdf/xlsx) в объектном хранилище.
 *
 * Скоуп (Model A): admin читает акт из `/admin`-зеркала без partnerId-фильтра,
 * партнёр — только свои. `partnerId` берётся из сессии, а не из аргументов:
 * так фильтр нельзя случайно не прокинуть. Сессия партнёра без `partnerId`
 * (в роут такая не доходит — её отсекает `requirePartner`) трактуется как
 * «ничего не видно», а не как «фильтра нет»: `partnerId: undefined` у Prisma
 * снял бы фильтр целиком и открыл акты всех партнёров.
 *
 * `not_found` (записи нет / чужой партнёр) и `not_generated` (файл ещё не
 * собран) различаются намеренно — роут отвечает 404 на оба, но с разным
 * текстом.
 */
export async function getStatementFilePath(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; format: StatementFileFormat }
): Promise<StatementFilePathResult> {
  let where: { id: string; partnerId?: string };
  if (session.role === 'admin') {
    where = { id: args.id };
  } else {
    if (!session.partnerId) return { ok: false, error: 'not_found' };
    where = { id: args.id, partnerId: session.partnerId };
  }

  const statement =
    args.format === 'pdf'
      ? await prisma.commissionStatement.findFirst({ where, select: { pdfPath: true } })
      : await prisma.commissionStatement.findFirst({ where, select: { xlsxPath: true } });

  if (!statement) return { ok: false, error: 'not_found' };

  const path = 'pdfPath' in statement ? statement.pdfPath : statement.xlsxPath;
  if (!path) return { ok: false, error: 'not_generated' };

  return { ok: true, path };
}

export async function getStatementWithItems(
  prisma: PrismaClient,
  statementId: string,
  partnerId: string
) {
  return prisma.commissionStatement.findFirst({
    where: { id: statementId, partnerId },
    include: { items: { orderBy: { organizationName: 'asc' } } },
  });
}
