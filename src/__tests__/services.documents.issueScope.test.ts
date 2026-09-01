/**
 * Этап 6, PR-6 (`У-145`) — кто может выпустить документ БЕЗ заказа.
 *
 * Модуль отдельный, потому что дверей две (выпуск и подгрузка формы), и
 * разъехавшись, они дали бы форму там, где сервер выпуск запретит.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { getCompanyTeamVisibility, canSeeOrganization } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrganization: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrganization }));

import { resolveLeadIssueScope, resolveOrgIssueScope } from '@/lib/services/documents/issueScope';

const session = (over: Record<string, unknown> = {}): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A', ...over }) as unknown as SessionPayload;

function prismaWith(org: unknown) {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(org) },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(true);
  canSeeOrganization.mockReturnValue(true);
});

describe('resolveOrgIssueScope', () => {
  it('клиентские роли не проходят гард роли и до базы не доходят', async () => {
    const prisma = prismaWith({ companyId: 'co-A' });
    for (const role of ['partner', 'organization', 'student']) {
      expect(await resolveOrgIssueScope(prisma, session({ role }), 'org-1')).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('нет организации → not_found; нет компании-исполнителя → org_no_company', async () => {
    expect(await resolveOrgIssueScope(prismaWith(null), session(), 'org-1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await resolveOrgIssueScope(prismaWith({ companyId: null }), session(), 'org-1')).toEqual(
      {
        ok: false,
        error: 'org_no_company',
      }
    );
  });

  it('чужая компания → not_found, даже если организация закреплена за менеджером', async () => {
    expect(
      await resolveOrgIssueScope(prismaWith({ companyId: 'co-B' }), session(), 'org-1')
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('в режиме общей видимости хватает своей компании; без него нужно закрепление', async () => {
    const prisma = prismaWith({ companyId: 'co-A' });
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: true,
      companyId: 'co-A',
    });

    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrganization.mockReturnValue(false);
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: false,
      error: 'not_found',
    });

    canSeeOrganization.mockReturnValue(true);
    expect(await resolveOrgIssueScope(prisma, session(), 'org-1')).toEqual({
      ok: true,
      companyId: 'co-A',
    });
  });

  it('администратору компания сессии не нужна — он вне контура менеджеров', async () => {
    const prisma = prismaWith({ companyId: 'co-B' });
    expect(
      await resolveOrgIssueScope(prisma, session({ role: 'admin', companyId: null }), 'org-1')
    ).toEqual({ ok: true, companyId: 'co-B' });
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });
});

/**
 * Этап 7 (`У-161`) — кто может выставить коммерческое предложение ЛИДУ.
 *
 * До этого PR такой двери не было вовсе: КП лиду не выпускали. Правила у лида
 * отличаются от организации, и каждое отличие проверяется отдельно, потому что
 * ошибка здесь означает бумагу с чужим клиентом внутри.
 *
 * `canSeeLead` намеренно НЕ мокается: он и есть единственная граница видимости
 * лида (компанией лиды не разделены), и подмена заглушкой проверяла бы только
 * то, что функцию позвали, а не то, что чужой лид действительно закрыт.
 */
const leadsProfile = (leads: 'own' | 'assigned' | 'all') => ({
  id: 'ap-1',
  name: 'Профиль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads,
  tasks: 'all',
  capabilities: [],
});

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  clientCompanyName: 'ООО «Ромашка»',
  clientContactName: 'Иван Петров',
  organizationId: null,
  assignedManagerId: 'm1',
  status: 'new',
  ...over,
});

function prismaWithLead(lead: unknown) {
  return { lead: { findUnique: vi.fn().mockResolvedValue(lead) } } as unknown as PrismaClient;
}

describe('resolveLeadIssueScope', () => {
  it('клиентские роли не проходят гард роли и до базы не доходят', async () => {
    // Предложение выставляет сотрудник. Партнёр, организация и студент —
    // клиенты: пусти их сюда, и клиент печатал бы документы от имени компании.
    const prisma = prismaWithLead(leadRow());
    for (const role of ['partner', 'organization', 'student']) {
      expect(await resolveLeadIssueScope(prisma, session({ role }), 'l1')).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
  });

  it('сотрудник без своей компании получает no_company, а не отказ по правам', async () => {
    // У лида компании нет в модели вовсе, её берут из сессии. Нет её и там —
    // выпускать не от чьего имени. Код отдельный намеренно: увидев «нет прав»,
    // сотрудник напрасно искал бы у себя недостающий доступ, хотя дело в
    // незаполненной карточке его учётной записи.
    const prisma = prismaWithLead(leadRow());
    expect(await resolveLeadIssueScope(prisma, session({ companyId: null }), 'l1')).toEqual({
      ok: false,
      error: 'no_company',
    });
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
  });

  it('лида нет → not_found', async () => {
    expect(await resolveLeadIssueScope(prismaWithLead(null), session(), 'l1')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('чужой лид при охвате «только свои» → not_found, а не forbidden', async () => {
    // Ключевая проверка этого PR. Менеджер с профилем «вижу только своих лидов»
    // не должен выставить предложение на чужого: имя и контакт чужого клиента
    // напечатались бы в его бумаге. Ответ именно «не найдено» — «нет прав»
    // подтвердило бы, что такой лид существует.
    const foreign = prismaWithLead(leadRow({ assignedManagerId: 'm2', organizationId: 'org-9' }));
    const scoped = session({ accessProfile: leadsProfile('own') });
    expect(await resolveLeadIssueScope(foreign, scoped, 'l1')).toEqual({
      ok: false,
      error: 'not_found',
    });

    // Зеркало: свой лид тому же менеджеру доступен — иначе «отказ всем» тоже
    // прошёл бы проверку выше и мы не заметили бы поломку.
    const mine = prismaWithLead(leadRow({ assignedManagerId: 'm1' }));
    expect((await resolveLeadIssueScope(mine, scoped, 'l1')).ok).toBe(true);
  });

  it('лид с закрытой судьбой адресатом быть не может', async () => {
    // Отказавшемуся клиенту предложение не нужно, а переданному в заказ его
    // выставляют уже по заказу — там есть организация, реквизиты и договор.
    for (const status of ['rejected', 'promoted_to_order']) {
      expect(
        await resolveLeadIssueScope(prismaWithLead(leadRow({ status })), session(), 'l1')
      ).toEqual({ ok: false, error: 'lead_not_active' });
    }
  });

  it('лид, ставший сделкой, предложение получить может', async () => {
    // Сделка — ровно то место, где КП и выставляют; запрет здесь закрыл бы
    // основной сценарий этапа.
    for (const status of ['new', 'in_review', 'qualified', 'promoted_to_deal']) {
      const res = await resolveLeadIssueScope(prismaWithLead(leadRow({ status })), session(), 'l1');
      expect(res.ok).toBe(true);
    }
  });

  it('успех отдаёт компанию из СЕССИИ и сам лид', async () => {
    // В строке лида нарочно лежит чужая компания: у лида её брать неоткуда и
    // нельзя — документ выпускается от имени компании сотрудника.
    const row = leadRow({ companyId: 'co-FOREIGN' });
    const res = await resolveLeadIssueScope(prismaWithLead(row), session(), 'l1');
    expect(res).toEqual({ ok: true, companyId: 'co-A', lead: row });
    // Имя и контакт клиента едут дальше в форму выпуска — без них шапка
    // предложения оказалась бы пустой. Сужение по `ok` обязательно: в типе
    // лид объявлен только у успеха, и компилятор это проверяет.
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.lead.clientCompanyName).toBe('ООО «Ромашка»');
  });

  it('администратор проходит гард роли', async () => {
    // Админ вне менеджерского контура, но выпускать документы ему можно —
    // сузь гард до менеджеров, и поддержка перестала бы выставлять КП.
    // Компания при этом нужна и ему: она берётся из его же учётной записи.
    const res = await resolveLeadIssueScope(
      prismaWithLead(leadRow()),
      session({ role: 'admin' }),
      'l1'
    );
    expect(res.ok).toBe(true);
  });

  it('из базы запрашиваются именно те поля, по которым принимается решение', async () => {
    // Не запроси мы охват и статус — решение о видимости и о допустимости лида
    // принималось бы по пустоте, и оно было бы тихим: ошибки нет, просто
    // проверка ни на что не смотрит.
    const prisma = prismaWithLead(leadRow());
    await resolveLeadIssueScope(prisma, session(), 'l1');
    const arg = (prisma.lead.findUnique as unknown as { mock: { calls: any[][] } }).mock
      .calls[0][0];
    expect(arg.where).toEqual({ id: 'l1' });
    expect(arg.select).toMatchObject({
      assignedManagerId: true,
      organizationId: true,
      status: true,
      clientCompanyName: true,
      clientContactName: true,
    });
  });
});
