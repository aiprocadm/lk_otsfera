import { describe, expect, it, vi, beforeEach } from 'vitest';

const { listQueue, listQueueOrgNames } = vi.hoisted(() => ({
  listQueue: vi.fn(),
  listQueueOrgNames: vi.fn(),
}));
vi.mock('@/lib/services/import/oneCAccountCard/resolve-queue', () => ({
  listQueue,
  listQueueOrgNames,
  QUEUE_PAGE_SIZE: 50,
}));

import { parseQueueQuery, loadQueuePage } from '@/lib/services/import/oneCAccountCard/queue-view';

const session = { sub: 'u1', role: 'admin', companyId: 'c1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  listQueue.mockResolvedValue({ rows: [], total: 0 });
  listQueueOrgNames.mockResolvedValue(new Map());
});

// `У-90`: параметры страницы очереди читаются из адреса — ссылка на страницу
// с фильтром обязана открываться той же страницей (иначе «поделиться» и
// «назад» не работают).
describe('parseQueueQuery (У-90)', () => {
  it('пустой адрес → первая страница по 50', () => {
    expect(parseQueueQuery({})).toMatchObject({ take: 50, skip: 0 });
  });

  it('читает страницу, фильтры и сортировку', () => {
    expect(
      parseQueueQuery({
        take: '25',
        skip: '100',
        inn: 'without',
        candidate: 'org',
        sort: 'amount',
        dir: 'asc',
      })
    ).toEqual({ take: 25, skip: 100, inn: 'without', candidate: 'org', sort: 'amount', dir: 'asc' });
  });

  it('мусор в адресе не ломает страницу и не подставляется в запрос', () => {
    expect(
      parseQueueQuery({ take: 'abc', skip: '-5', inn: 'нет', candidate: 'x', sort: 'y', dir: 'z' })
    ).toEqual({ take: 50, skip: 0 });
  });

  it('массив в параметре (a=1&a=2) берётся первым значением', () => {
    expect(parseQueueQuery({ inn: ['with', 'without'] })).toMatchObject({ inn: 'with' });
  });
});

describe('loadQueuePage (У-90)', () => {
  it('передаёт разобранный запрос сервису и возвращает страницу со счётчиком', async () => {
    listQueue.mockResolvedValue({ rows: [], total: 250 });
    const res = await loadQueuePage({} as never, session, { skip: '50', inn: 'without' });
    expect(listQueue).toHaveBeenCalledWith({}, session, { take: 50, skip: 50, inn: 'without' });
    expect(res).toMatchObject({ total: 250, take: 50, skip: 50 });
  });

  it('строка приводится к виду для экрана: имя кандидата, суммы строками, ключ', async () => {
    listQueue.mockResolvedValue({
      rows: [
        {
          id: 'r1',
          externalId: '0000-1',
          paidAt: new Date('2026-06-01T00:00:00.000Z'),
          amount: '14800',
          isRefund: false,
          purpose: 'Оплата',
          counterpartyName: 'ООО «Ромашка»',
          counterpartyInn: null,
          counterpartyKey: 'РОМАШКА',
          accountCandidates: ['260509-1905'],
          candidateOrgId: 'org-1',
          candidateOrderId: null,
          matchMethod: 'name_fuzzy',
          batch: { companyId: 'co-1' },
        },
      ],
      total: 1,
    });
    listQueueOrgNames.mockResolvedValue(new Map([['org-1', 'Ромашка ООО']]));

    const res = await loadQueuePage({} as never, session, {});

    expect(listQueueOrgNames).toHaveBeenCalledWith({}, ['org-1']);
    expect(res.rows[0]).toEqual({
      id: 'r1',
      externalId: '0000-1',
      paidAt: '2026-06-01T00:00:00.000Z',
      amount: '14800',
      isRefund: false,
      purpose: 'Оплата',
      counterpartyName: 'ООО «Ромашка»',
      counterpartyInn: null,
      counterpartyKey: 'РОМАШКА',
      accountCandidates: ['260509-1905'],
      candidateOrgId: 'org-1',
      candidateOrgName: 'Ромашка ООО',
      candidateOrderId: null,
      matchMethod: 'name_fuzzy',
      batchCompanyId: 'co-1',
    });
  });

  it('строка без кандидата не тянет имена организаций', async () => {
    listQueue.mockResolvedValue({
      rows: [
        {
          id: 'r2',
          externalId: '0000-2',
          paidAt: new Date('2026-06-02T00:00:00.000Z'),
          amount: '100',
          isRefund: true,
          purpose: null,
          counterpartyName: null,
          counterpartyInn: null,
          counterpartyKey: null,
          accountCandidates: null,
          candidateOrgId: null,
          candidateOrderId: null,
          matchMethod: 'none',
          batch: { companyId: null },
        },
      ],
      total: 1,
    });
    const res = await loadQueuePage({} as never, session, {});
    expect(listQueueOrgNames).toHaveBeenCalledWith({}, []);
    expect(res.rows[0]).toMatchObject({
      candidateOrgName: null,
      accountCandidates: [],
      batchCompanyId: null,
    });
  });
});
