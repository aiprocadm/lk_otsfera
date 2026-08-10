import { describe, it, expect, vi, beforeEach } from 'vitest';

const { canReadDocument } = vi.hoisted(() => ({ canReadDocument: vi.fn() }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';

const s = (over: Record<string, unknown> = {}) =>
  ({ sub: 'u1', role: 'manager', ...over }) as never;

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  studentId: 'st1',
  fullName: 'Иван Иванов',
  email: 'i@x.ru',
  position: null,
  snils: null,
  birthDate: null,
  extra: null,
  status: 'certificates_ready',
  externalStudentId: null,
  // У-33 + PR-3 «замок»: направление у позиции ОБЯЗАТЕЛЬНО, позиции без него
  // в базе больше нет.
  directionId: 'd1',
  direction: { name: 'Охрана труда' },
  ...over,
});

const reqRow = (over: Record<string, unknown> = {}) => ({
  id: 'E1',
  directionId: 'd1',
  direction: { name: 'Охрана труда' },
  legacyCourseTitle: null,
  organization: { name: 'Ромашка' },
  partner: null,
  submittedByUser: { name: 'Юзер' },
  submitterRole: 'organization',
  status: 'certificates_ready',
  note: null,
  rejectedReason: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  reviewedAt: null,
  provisionedAt: null,
  items: [item()],
  ...over,
});

function db(row: unknown, certs: unknown[] = [], docs: unknown[] = []) {
  const findFirst = vi.fn().mockResolvedValue(row);
  const certFindMany = vi.fn().mockResolvedValue(certs);
  const docFindMany = vi.fn().mockResolvedValue(docs);
  return {
    d: {
      enrollmentRequest: { findFirst },
      certificate: { findMany: certFindMany },
      document: { findMany: docFindMany },
    } as never,
    findFirst,
    certFindMany,
    docFindMany,
  };
}

const DOC = {
  id: 'doc1',
  orderId: null,
  companyId: 'c1',
  counterpartyType: null,
  counterpartyId: null,
  order: null,
};

beforeEach(() => {
  canReadDocument.mockReset().mockResolvedValue(true);
  recordPiiAccess.mockReset();
});

describe('getEnrollmentRequest (деталка заявки, ФТ-2.3)', () => {
  it('чужая/несуществующая заявка → not_found; скоуп из scopeWhere в where', async () => {
    const { d, findFirst } = db(null);
    const r = await getEnrollmentRequest(d, s({ role: 'partner', partnerId: 'p1' }), 'EX');
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ AND: [{ id: 'EX' }, { partnerId: 'p1' }] });
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('legacy-заявка: заголовок из текста курса, но удостоверение ищется по направлению ПОЗИЦИИ', async () => {
    // У старой заявки направления на шапке нет (курс вписан текстом), а у
    // позиции оно есть — его проставил человек при разборе (`У-34а`). После
    // «замка» это единственно возможное состояние, поэтому сертификаты
    // запрашиваются как обычно.
    const { d, certFindMany } = db(
      reqRow({ directionId: null, direction: null, legacyCourseTitle: 'Старый курс' })
    );
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(certFindMany.mock.calls[0]![0].where).toMatchObject({ directionId: { in: ['d1'] } });
    expect(r.request.directionName).toBe('Старый курс');
    expect(r.request.items[0]!.certificateDocumentId).toBeNull();
  });

  it('У-33: удостоверение подбирается по направлению ПОЗИЦИИ, а не по шапке заявки', async () => {
    // Один и тот же человек в заявке дважды — на два разных обучения. По шапке
    // обе позиции получили бы одну и ту же корочку; правильно — каждая свою.
    const { d, certFindMany } = db(
      reqRow({
        items: [
          item({ id: 'i1', studentId: 'st1', directionId: 'd1', direction: { name: 'Высота' } }),
          item({ id: 'i2', studentId: 'st1', directionId: 'd2', direction: { name: 'Электро' } }),
        ],
      }),
      [
        { studentId: 'st1', directionId: 'd1', documentId: 'docВысота' },
        { studentId: 'st1', directionId: 'd2', documentId: 'docЭлектро' },
      ],
      [
        { ...DOC, id: 'docВысота' },
        { ...DOC, id: 'docЭлектро' },
      ]
    );
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');

    expect(certFindMany.mock.calls[0]![0].where).toMatchObject({
      studentId: { in: ['st1'] },
      directionId: { in: ['d1', 'd2'] },
    });
    expect(r.request.items[0]!.certificateDocumentId).toBe('docВысота');
    expect(r.request.items[1]!.certificateDocumentId).toBe('docЭлектро');
    // У-43: имя направления позиции доезжает до экрана.
    expect(r.request.items.map((i) => i.directionName)).toEqual(['Высота', 'Электро']);
    expect(r.request.directionNames).toEqual(['Высота', 'Электро']);
  });

  it('certificates_ready + Certificate с документом → certificateDocumentId; свежайший сертификат побеждает', async () => {
    const { d, certFindMany } = db(
      reqRow(),
      [
        { studentId: 'st1', directionId: 'd1', documentId: 'doc1' },
        { studentId: 'st1', directionId: 'd1', documentId: 'docOld' },
      ],
      [DOC]
    );
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    // У-33: сертификат ищется по паре «слушатель + направление ПОЗИЦИИ»
    // (у позиции его нет → берётся направление шапки).
    expect(certFindMany).toHaveBeenCalledWith({
      where: { studentId: { in: ['st1'] }, directionId: { in: ['d1'] }, documentId: { not: null } },
      orderBy: { issuedAt: 'desc' },
      select: { studentId: true, directionId: true, documentId: true },
    });
    expect(canReadDocument).toHaveBeenCalledWith(
      s(),
      expect.objectContaining({
        id: 'doc1',
        counterpartyType: undefined,
        counterpartyId: undefined,
        order: null,
      })
    );
    expect(r.request.items[0]!.certificateDocumentId).toBe('doc1');
  });

  it('удостоверение привязано к заявке: компания заявки уходит в проверку прав', async () => {
    // Документ может висеть на заявке (тогда у него есть order с компанией), а не
    // на компании напрямую. Проверка прав обязана получить именно компанию заявки,
    // иначе документ либо утечёт, либо перестанет открываться у своих.
    const withOrder = { ...DOC, orderId: 'o1', companyId: null, order: { companyId: 'c9' } };
    const { d } = db(reqRow(), [{ studentId: 'st1', documentId: 'doc1' }], [withOrder]);
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(canReadDocument).toHaveBeenCalledWith(
      s(),
      expect.objectContaining({ id: 'doc1', order: { companyId: 'c9' } })
    );
  });

  it('canReadDocument=false → ссылки на удостоверение нет (кнопка не ведёт в 403)', async () => {
    canReadDocument.mockResolvedValue(false);
    const { d } = db(reqRow(), [{ studentId: 'st1', documentId: 'doc1' }], [DOC]);
    const r = await getEnrollmentRequest(d, s({ role: 'partner', partnerId: 'p1' }), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.items[0]!.certificateDocumentId).toBeNull();
  });

  it('позиции не certificates_ready или без studentId → сертификаты не запрашиваются', async () => {
    const { d, certFindMany } = db(
      reqRow({ items: [item({ status: 'in_training' }), item({ id: 'i2', studentId: null })] })
    );
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(certFindMany).not.toHaveBeenCalled();
    expect(r.request.items.map((i) => i.certificateDocumentId)).toEqual([null, null]);
  });

  it('маппинг полей шапки + PII-журнал деталки', async () => {
    const { d } = db(reqRow({ items: [item({ status: 'in_training' })] }));
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.request).toMatchObject({
      id: 'E1',
      directionName: 'Охрана труда',
      status: 'certificates_ready',
      organizationName: 'Ромашка',
      partnerName: null,
      submittedByName: 'Юзер',
      submitterRole: 'organization',
    });
    expect(recordPiiAccess).toHaveBeenCalledWith(
      d,
      expect.objectContaining({
        context: 'enrollment_detail',
        subjectIds: ['E1'],
      })
    );
  });

  it('direction=null и legacyCourseTitle=null → «—»; partner.name маппится', async () => {
    const { d } = db(
      reqRow({
        direction: null,
        directionId: null,
        organization: null,
        partner: { name: 'Партнёр+' },
        items: [],
      })
    );
    const r = await getEnrollmentRequest(d, s(), 'E1');
    if (!r.ok) throw new Error('expected ok');
    expect(r.request.directionName).toBe('—');
    expect(r.request.organizationName).toBeNull();
    expect(r.request.partnerName).toBe('Партнёр+');
    expect(r.request.items).toEqual([]);
  });
});
