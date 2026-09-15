import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  recordPiiAccessMany: vi.fn(),
  listCertificates: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', async () => ({
  ...(await vi.importActual<typeof import('@/lib/auth/managerPolicy')>('@/lib/auth/managerPolicy')),
  getCompanyTeamVisibility: m.getCompanyTeamVisibility,
}));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccessMany: m.recordPiiAccessMany }));
vi.mock('@/lib/services/training/certificates', () => ({ listCertificates: m.listCertificates }));

import { getOrganizationCard, ORG_CARD_TAB_CAP } from '@/lib/services/manager/organizationCard';

/**
 * Вкладка «Диалоги» карточки организации (`У-210`).
 *
 * Проверяем три вещи, каждая из которых уже ломалась в соседних вкладках:
 * 1) переписка организации — это И её собственные диалоги, И диалоги её
 *    контактов; без второго условия вкладка была бы пустой при живой переписке
 *    (привязка к организации появляется только при разборе «Входящих»);
 * 2) счётчик «показаны 20 из M» считается по ТОМУ ЖЕ условию, что и список —
 *    разъехавшиеся `where` давали бы «показаны 20 из 7» (`С-6`);
 * 3) чтение переписки попадает в журнал ПДн с контекстом `org_card_dialogs`.
 */

/** Заготовка Prisma: у каждой модели пустые списки и нули — заполняем нужное. */
function makePrisma(overrides: Record<string, Record<string, unknown>> = {}) {
  const model = (extra: Record<string, unknown> = {}) => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    ...extra,
  });
  const base: Record<string, Record<string, unknown>> = {
    organization: { findUnique: vi.fn().mockResolvedValue(org) },
    order: model({ aggregate: vi.fn().mockResolvedValue({ _sum: {} }) }),
    document: model(),
    payment: model({ aggregate: vi.fn().mockResolvedValue({ _sum: {} }) }),
    comment: model(),
    enrollmentRequest: model(),
    clientRequest: model(),
    inboundMessage: model(),
    messengerDialog: model(),
    call: model(),
    lead: model(),
    deal: model(),
  };
  for (const [name, patch] of Object.entries(overrides)) {
    base[name] = { ...base[name], ...patch };
  }
  return base as unknown as PrismaClient & Record<string, Record<string, ReturnType<typeof vi.fn>>>;
}

const org = {
  id: 'o1',
  name: 'Ромашка',
  inn: '7700000001',
  kpp: null,
  legalName: null,
  ogrn: null,
  legalAddress: null,
  bankName: null,
  bankAccount: null,
  corrAccount: null,
  bic: null,
  signerName: null,
  signerPosition: null,
  signerBasis: null,
  companyId: 'c1',
  partnerCommissionRate: null,
  partnerCommissionRateNote: null,
  partnerId: null,
  partner: null,
  _count: { orders: 0, students: 0, organizationUsers: 0, contacts: 0 },
};

const staffSession = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;

/** Скоуп диалогов: своя компания + ничейные (общая очередь). */
const SCOPE = { OR: [{ companyId: 'c1' }, { companyId: null }] };
/** Условие вкладки целиком — его ждём и в выборке, и в счётчике. */
const DIALOGS_WHERE = {
  AND: [SCOPE, { OR: [{ organizationId: 'o1' }, { contact: { organizationId: 'o1' } }] }],
};

const dialogRow = {
  id: 'd1',
  channel: 'telegram',
  status: 'waiting_staff',
  peerDisplay: 'Иван',
  peerRef: 'tg-1',
  lastMessageAt: new Date('2026-09-14T09:00:00Z'),
  lastMessagePreview: 'здравствуйте',
  waitingSince: new Date('2026-09-14T09:00:00Z'),
};

describe('getOrganizationCard — вкладка «Диалоги» (У-210)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    m.listCertificates.mockResolvedValue({ ok: true, certificates: [], total: 0 });
  });

  it('выборка: организация ИЛИ её контакты, под скоупом диалогов, свежие сверху', async () => {
    const prisma = makePrisma({
      messengerDialog: {
        findMany: vi.fn().mockResolvedValue([dialogRow]),
        count: vi.fn().mockResolvedValue(37),
      },
    });
    await getOrganizationCard(prisma, staffSession, 'o1');
    expect(prisma.messengerDialog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: DIALOGS_WHERE,
        // Хвост `id` — устойчивый порядок при равном времени (бэкфилл).
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: ORG_CARD_TAB_CAP,
      })
    );
  });

  it('счётчик вкладки считает ровно то, что показывает список (С-6)', async () => {
    const prisma = makePrisma({
      messengerDialog: {
        findMany: vi.fn().mockResolvedValue([dialogRow]),
        count: vi.fn().mockResolvedValue(37),
      },
    });
    const card = await getOrganizationCard(prisma, staffSession, 'o1');
    // Одно и то же условие в двух местах — иначе экран напишет «показаны 20
    // из 7», и человек решит, что список врёт.
    expect(prisma.messengerDialog.count).toHaveBeenCalledWith({ where: DIALOGS_WHERE });
    expect(card?.tabTotals.dialogs).toBe(37);
  });

  it('строка вкладки несёт то, по чему узнают переписку', async () => {
    const prisma = makePrisma({
      messengerDialog: { findMany: vi.fn().mockResolvedValue([dialogRow]) },
    });
    const card = await getOrganizationCard(prisma, staffSession, 'o1');
    expect(card?.dialogs).toEqual([
      {
        id: 'd1',
        channel: 'telegram',
        status: 'waiting_staff',
        peerDisplay: 'Иван',
        peerRef: 'tg-1',
        lastMessageAt: dialogRow.lastMessageAt,
        // Превью — уже обрезанный текст самого диалога; внутренние заметки в
        // него не попадают (`У-208`).
        lastMessagePreview: 'здравствуйте',
        waitingSince: dialogRow.waitingSince,
      },
    ]);
  });

  it('чтение переписки фиксируется в журнале ПДн (org_card_dialogs)', async () => {
    const prisma = makePrisma({
      messengerDialog: {
        findMany: vi.fn().mockResolvedValue([dialogRow, { ...dialogRow, id: 'd2' }]),
      },
    });
    await getOrganizationCard(prisma, staffSession, 'o1');
    expect(m.recordPiiAccessMany).toHaveBeenCalledWith(
      prisma,
      expect.arrayContaining([
        { session: staffSession, context: 'org_card_dialogs', subjectIds: ['d1', 'd2'] },
      ])
    );
  });

  it('граница компании держится и здесь: сессия без компании не видит «все компании»', async () => {
    // Карточку уже проверил гард доступа, но фильтр компании на выборке —
    // последняя дверь (CLAUDE.md §4), и сокращать её нельзя.
    const prisma = makePrisma();
    const noCompany = { ...staffSession, companyId: null } as SessionPayload;
    m.getCompanyTeamVisibility.mockResolvedValue(false);
    await getOrganizationCard(prisma, noCompany, 'o1');
    expect(prisma.messengerDialog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ companyId: '__no_company__' }, { companyId: null }] },
            { OR: [{ organizationId: 'o1' }, { contact: { organizationId: 'o1' } }] },
          ],
        },
      })
    );
  });

  it('клиентскому кабинету переписка учебного центра не грузится вовсе', async () => {
    const prisma = makePrisma({
      messengerDialog: { findMany: vi.fn().mockResolvedValue([dialogRow]) },
    });
    const orgSession = {
      sub: 'org-user',
      role: 'organization',
      companyId: null,
      organizationMemberships: [{ organizationId: 'o1', isActive: true }],
    } as unknown as SessionPayload;
    const card = await getOrganizationCard(prisma, orgSession, 'o1');
    // Не «пустой список после запроса», а запроса нет: внутренние данные
    // учебного центра клиентским ролям не показывают вовсе.
    expect(prisma.messengerDialog.findMany).not.toHaveBeenCalled();
    expect(card?.dialogs).toEqual([]);
    expect(card?.tabTotals.dialogs).toBe(0);
  });

  it('чужая организация → null, до выборки диалогов дело не доходит', async () => {
    m.getCompanyTeamVisibility.mockResolvedValue(true);
    const prisma = makePrisma({
      organization: { findUnique: vi.fn().mockResolvedValue({ ...org, companyId: 'other' }) },
    });
    await expect(getOrganizationCard(prisma, staffSession, 'o1')).resolves.toBeNull();
    expect(prisma.messengerDialog.findMany).not.toHaveBeenCalled();
  });
});
