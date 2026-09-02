/**
 * Unit tests for src/lib/services/manager/leads.ts
 * Covers getManagerLead (not in existing unit test) and additional
 * listManagerLeads branches (with cursor, estimatedAmount, organization).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { Decimal } from '@prisma/client/runtime/library';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';
import { listManagerLeads, getManagerLead } from '@/lib/services/manager/leads';

const SESSION = { sub: 'mgr-1', role: 'manager' as const, companyId: 'co-1' };

beforeEach(() => {
  recordPiiAccess.mockClear();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function leadRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    clientCompanyName: 'Acme Corp',
    clientInn: null,
    subject: 'Обучение',
    status: 'new',
    estimatedAmount: null,
    organization: null,
    partner: { name: 'Partner A' },
    assignedManagerId: null,
    assignedManager: null,
    promotedOrderId: null,
    createdAt: new Date('2026-06-01'),
    ...over,
  };
}

// ─── listManagerLeads ──────────────────────────────────────────────────────────

describe('listManagerLeads', () => {
  it('returns page without nextCursor when rows <= take', async () => {
    const rows = [leadRow('L1'), leadRow('L2')];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, { take: 20 });
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).toBeNull();
  });

  it('maps estimatedAmount Decimal to toFixed(2) string', async () => {
    const rows = [leadRow('L1', { estimatedAmount: new Decimal('12345.678') })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.estimatedAmount).toBe('12345.68');
  });

  it('keeps estimatedAmount null when not set', async () => {
    const rows = [leadRow('L1', { estimatedAmount: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.estimatedAmount).toBeNull();
  });

  it('maps organization id/name when present', async () => {
    const rows = [leadRow('L1', { organization: { id: 'o1', name: 'Org One' } })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.organizationId).toBe('o1');
    expect(r.rows[0]!.organizationName).toBe('Org One');
  });

  it('maps organizationId/organizationName to null when organization is null', async () => {
    const rows = [leadRow('L1', { organization: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.organizationId).toBeNull();
    expect(r.rows[0]!.organizationName).toBeNull();
  });

  it('maps assignedManagerName to null when assignedManager is null', async () => {
    const rows = [leadRow('L1', { assignedManager: null })];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.assignedManagerName).toBeNull();
  });

  it('maps assignedManagerName from nested object', async () => {
    const rows = [
      leadRow('L1', { assignedManager: { name: 'Ivanov' }, assignedManagerId: 'mgr-1' }),
    ];
    const db = { lead: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
    const r = await listManagerLeads(db, {});
    expect(r.rows[0]!.assignedManagerName).toBe('Ivanov');
  });

  it('passes cursor to findMany when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, { cursor: 'cursor-id-1' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'cursor-id-1' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, {});
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });

  it('uses default take=20 when not specified', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { lead: { findMany } } as never;
    await listManagerLeads(db, {});
    const call = findMany.mock.calls[0][0];
    expect(call.take).toBe(21); // take+1 for "has more" detection
  });
});

// ─── getManagerLead ────────────────────────────────────────────────────────────

/**
 * Мини-«база» для карточки лида: сам лид и таблица документов.
 *
 * `document.findMany` здесь не отдаёт заранее готовый ответ, а ПО-НАСТОЯЩЕМУ
 * применяет условия запроса и сортировку. Это важно: если из сервиса убрать
 * условие «заменённые версии не берём», подделка честно вернёт и старую
 * версию — и тест покраснеет. Мок, который отдаёт список как есть, такую
 * ошибку пропустил бы.
 */
function dbFor(lead: unknown, documents: Array<Record<string, unknown>> = []) {
  const findMany = vi.fn(
    async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }) => {
      const rows = documents.filter((d) =>
        Object.entries(where).every(([field, value]) => d[field] === value)
      );
      const dir = orderBy?.createdAt;
      if (dir) {
        rows.sort((a, b) => {
          const diff = (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime();
          return dir === 'asc' ? diff : -diff;
        });
      }
      return rows;
    }
  );
  return {
    lead: { findUnique: vi.fn().mockResolvedValue(lead) },
    document: { findMany },
  };
}

/** Строка таблицы документов: только те поля, которыми пользуется карточка. */
function proposalRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    leadId: 'L1',
    type: 'commercial_proposal',
    supersededAt: null,
    number: 'КП-7',
    status: 'draft',
    createdAt: new Date('2026-06-01'),
    validUntil: new Date('2026-06-15'),
    amountGross: null,
    ...over,
  };
}

/** Профиль охвата: «вижу только свои лиды» и т.п. */
function sessionWithLeadScope(leads: SessionAccessProfile['leads']): SessionPayload {
  return {
    ...SESSION,
    managedOrgIds: ['org-managed'],
    accessProfile: {
      id: 'p1',
      name: 'Продажи',
      orders: 'own',
      organizations: 'own',
      threads: 'own',
      documents: 'own',
      finance: 'own',
      leads,
      tasks: 'all',
      capabilities: [],
    },
  } as unknown as SessionPayload;
}

describe('getManagerLead', () => {
  function fullRow(over: Record<string, unknown> = {}) {
    return {
      id: 'L1',
      clientCompanyName: 'Acme',
      clientInn: '7701000001',
      subject: 'Обучение сотрудников',
      status: 'in_review',
      estimatedAmount: null,
      organization: null,
      organizationId: null,
      partner: { name: 'Partner B' },
      assignedManagerId: 'mgr-1',
      assignedManager: { name: 'Иванов' },
      promotedOrderId: null,
      createdAt: new Date('2026-06-01'),
      clientContactName: 'Контактное лицо',
      clientContactPhone: '+7 999 000 0000',
      clientContactEmail: 'contact@acme.ru',
      productType: ['training'],
      notes: 'Приоритет высокий',
      rejectedReason: null,
      createdByUser: { name: 'Admin' },
      updatedAt: new Date('2026-06-05'),
      externalIdInOneC: null,
      pushedToOneCAt: null,
      ...over,
    };
  }

  it('returns null when lead is not found', async () => {
    const db = dbFor(null) as never;
    const result = await getManagerLead(db, SESSION, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns the full detail payload when lead is found', async () => {
    const db = dbFor(fullRow()) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('L1');
    expect(result!.clientContactName).toBe('Контактное лицо');
    expect(result!.clientContactPhone).toBe('+7 999 000 0000');
    expect(result!.clientContactEmail).toBe('contact@acme.ru');
    expect(result!.productType).toEqual(['training']);
    expect(result!.notes).toBe('Приоритет высокий');
    expect(result!.rejectedReason).toBeNull();
    expect(result!.createdByUserName).toBe('Admin');
    expect(result!.partnerName).toBe('Partner B');
    expect(result!.assignedManagerName).toBe('Иванов');
    expect(result!.externalIdInOneC).toBeNull();
    expect(result!.pushedToOneCAt).toBeNull();
  });

  it('прокидывает externalIdInOneC/pushedToOneCAt (B3: строка «1С» на странице лида)', async () => {
    const pushedAt = new Date('2026-06-05T10:00:00Z');
    const db = dbFor(fullRow({ externalIdInOneC: 'EXT-77', pushedToOneCAt: pushedAt })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.externalIdInOneC).toBe('EXT-77');
    expect(result!.pushedToOneCAt).toEqual(pushedAt);
  });

  it('maps estimatedAmount Decimal to string when present', async () => {
    const db = dbFor(fullRow({ estimatedAmount: new Decimal('5000.00') })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.estimatedAmount).toBe('5000.00');
  });

  it('maps estimatedAmount to null when absent', async () => {
    const db = dbFor(fullRow({ estimatedAmount: null })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.estimatedAmount).toBeNull();
  });

  it('maps organization id/name when present', async () => {
    const db = dbFor(fullRow({ organization: { id: 'o1', name: 'Org One' } })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.organizationId).toBe('o1');
    expect(result!.organizationName).toBe('Org One');
  });

  it('maps organizationId/organizationName to null when organization is null', async () => {
    const db = dbFor(fullRow({ organization: null })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.organizationId).toBeNull();
    expect(result!.organizationName).toBeNull();
  });

  it('maps assignedManagerName to null when assignedManager is null', async () => {
    const db = dbFor(fullRow({ assignedManager: null })) as never;
    const result = await getManagerLead(db, SESSION, 'L1');
    expect(result!.assignedManagerName).toBeNull();
  });

  it('журналирует выдачу контактных ПДн (view)', async () => {
    const db = dbFor(fullRow()) as never;
    await getManagerLead(db, SESSION, 'L1');
    expect(recordPiiAccess).toHaveBeenCalledWith(db, {
      session: SESSION,
      context: 'manager_lead_view',
      subjectIds: ['L1'],
    });
  });

  it('null-ветка: журнал не пишется', async () => {
    const db = dbFor(null) as never;
    await getManagerLead(db, SESSION, 'nope');
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  // ─── охват профиля (`У-161`, этап 7) ────────────────────────────────────────
  // Раньше карточка охват профиля не спрашивала: список лидов чужие заявки
  // прятал, а карточка по прямому адресу открывалась любому менеджеру — вместе
  // с именем, телефоном и почтой чужого клиента.

  it('менеджер «только свои» получает null на чужом лиде — карточка не открывается', async () => {
    const db = dbFor(fullRow({ assignedManagerId: 'другой-менеджер' })) as never;

    const result = await getManagerLead(db, sessionWithLeadScope('own'), 'L1');

    expect(result).toBeNull();
  });

  it('на чужом лиде не пишется журнал ПДн и не читаются предложения', async () => {
    // Отказ должен быть «до» любой работы с данными: запись в журнал выдачи
    // ПДн означала бы, что контакты человеку показали, а это неправда.
    const db = dbFor(fullRow({ assignedManagerId: 'другой-менеджер' }));

    await getManagerLead(db as never, sessionWithLeadScope('own'), 'L1');

    expect(recordPiiAccess).not.toHaveBeenCalled();
    expect(db.document.findMany).not.toHaveBeenCalled();
  });

  it('менеджер «только свои» открывает свой лид', async () => {
    // Обратная сторона проверки: гейт не должен закрывать карточку насовсем.
    const db = dbFor(fullRow({ assignedManagerId: SESSION.sub })) as never;

    const result = await getManagerLead(db, sessionWithLeadScope('own'), 'L1');

    expect(result).not.toBeNull();
    expect(result!.clientContactPhone).toBe('+7 999 000 0000');
  });

  it('менеджер «свои и подшефные» открывает лид закреплённой за ним организации', async () => {
    const db = dbFor(
      fullRow({ assignedManagerId: 'другой-менеджер', organizationId: 'org-managed' })
    ) as never;

    const result = await getManagerLead(db, sessionWithLeadScope('assigned'), 'L1');

    expect(result).not.toBeNull();
  });

  // ─── предложения лида (`У-161`) ─────────────────────────────────────────────

  it('отдаёт коммерческие предложения лида', async () => {
    const db = dbFor(fullRow(), [
      proposalRow('doc-1', { number: 'КП-7', status: 'sent' }),
    ]) as never;

    // «Сейчас» задаётся явно: без него состояние зависело бы от дня прогона —
    // срок у фикстуры 15.06, и в июле тест начал бы падать сам по себе.
    const result = await getManagerLead(db, SESSION, 'L1', new Date('2026-06-10T09:00:00.000Z'));

    expect(result!.proposals).toHaveLength(1);
    expect(result!.proposals[0]).toMatchObject({
      id: 'doc-1',
      number: 'КП-7',
      status: 'sent',
      validUntil: new Date('2026-06-15'),
    });
  });

  it('`У-164`: истёкшее предложение показывается истёкшим сразу, до ночной задачи', async () => {
    // Иначе менеджер увидит «Отправлен» у бумаги, которую клиент уже не
    // примет, и будет ждать ответа, которого не будет.
    const db = dbFor(fullRow(), [
      proposalRow('doc-1', { number: 'КП-7', status: 'sent' }),
    ]) as never;

    const result = await getManagerLead(db, SESSION, 'L1', new Date('2026-06-16T09:00:00.000Z'));

    expect(result!.proposals[0]).toMatchObject({ status: 'expired' });
  });

  it('черновик с прошедшей датой остаётся черновиком', async () => {
    // Срок стоит уже у черновика, но клиенту его не отправляли — «Истёк срок»
    // здесь был бы неправдой.
    const db = dbFor(fullRow(), [proposalRow('doc-1', { status: 'draft' })]) as never;

    const result = await getManagerLead(db, SESSION, 'L1', new Date('2026-06-16T09:00:00.000Z'));

    expect(result!.proposals[0]).toMatchObject({ status: 'draft' });
  });

  it('не отдаёт заменённые версии предложения', async () => {
    // При перевыпуске у нового КП тот же номер, а старая версия помечается
    // «заменена». Покажи обе — и менеджер увидит два одинаковых номера и
    // отправит клиенту устаревшую бумагу.
    const db = dbFor(fullRow(), [
      proposalRow('старая-версия', { supersededAt: new Date('2026-06-10') }),
      proposalRow('свежая-версия'),
    ]) as never;

    const result = await getManagerLead(db, SESSION, 'L1');

    expect(result!.proposals.map((p) => p.id)).toEqual(['свежая-версия']);
  });

  it('не отдаёт документы другого лида и бумаги других видов', async () => {
    // Список строится по всей таблице документов, поэтому важно, что отбор
    // идёт и по лиду, и по виду документа: счёт или чужое КП в блоке
    // «Коммерческие предложения» — это подсказка выставить не то и не тому.
    const db = dbFor(fullRow(), [
      proposalRow('кп-чужого-лида', { leadId: 'L2' }),
      proposalRow('счёт-этого-лида', { type: 'invoice' }),
      proposalRow('своё-кп'),
    ]) as never;

    const result = await getManagerLead(db, SESSION, 'L1');

    expect(result!.proposals.map((p) => p.id)).toEqual(['своё-кп']);
  });

  it('сортирует предложения от свежих к старым', async () => {
    // Актуальное предложение — верхнее. Иначе менеджер откроет первое в списке
    // и это окажется прошлогодняя версия.
    const db = dbFor(fullRow(), [
      proposalRow('позапрошлое', { createdAt: new Date('2026-01-01') }),
      proposalRow('вчерашнее', { createdAt: new Date('2026-06-20') }),
      proposalRow('прошлогоднее', { createdAt: new Date('2025-05-05') }),
    ]) as never;

    const result = await getManagerLead(db, SESSION, 'L1');

    expect(result!.proposals.map((p) => p.id)).toEqual([
      'вчерашнее',
      'позапрошлое',
      'прошлогоднее',
    ]);
  });

  it('сумму предложения отдаёт строкой с копейками, пустую — null', async () => {
    // Decimal из базы нельзя отдать в клиентский компонент как есть, поэтому
    // сервис превращает его в строку. Копейки обязаны сохраниться.
    const db = dbFor(fullRow(), [
      proposalRow('с-суммой', { amountGross: new Decimal('12000.5') }),
      proposalRow('без-суммы', { amountGross: null, createdAt: new Date('2025-01-01') }),
    ]) as never;

    const result = await getManagerLead(db, SESSION, 'L1');

    expect(result!.proposals[0]!.amountGross).toBe('12000.50');
    expect(result!.proposals[1]!.amountGross).toBeNull();
  });

  it('у лида без предложений список пустой', async () => {
    const db = dbFor(fullRow()) as never;

    const result = await getManagerLead(db, SESSION, 'L1');

    expect(result!.proposals).toEqual([]);
  });
});
