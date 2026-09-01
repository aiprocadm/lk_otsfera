/**
 * Сервис «Шаблоны документов» (`У-160`, этап 6 PR-7): границы компании,
 * лимиты, номер редакции и журнал действий. Prisma — фейк.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import {
  listCompanyTemplates,
  resetCompanyTemplate,
  saveCompanyTemplate,
  SLOT_TEXT_MAX,
} from '@/lib/services/documents/templates';
import { DOCUMENT_TEMPLATE_SLOTS } from '@/lib/documents/documentTemplate';

const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;
const leader = (over: Record<string, unknown> = {}): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId: 'co-A', ...over }) as unknown as SessionPayload;
const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

function makePrisma(over: Record<string, unknown> = {}) {
  const upsert = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const companyUpdate = vi.fn().mockResolvedValue({ documentTemplateRevision: 4 });
  const tx = {
    company: { update: companyUpdate },
    documentTemplate: { upsert, deleteMany },
  };
  const prisma = {
    documentTemplate: { findMany: vi.fn().mockResolvedValue(over.saved ?? []) },
    company: {
      findUnique: vi.fn().mockResolvedValue('company' in over ? over.company : { id: 'co-A' }),
      update: companyUpdate,
    },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx, upsert, deleteMany, companyUpdate };
}

beforeEach(() => vi.clearAllMocks());

describe('listCompanyTemplates', () => {
  it('отдаёт ВЕСЬ реестр: и свои тексты, и те, что печатаются встроенными', async () => {
    const { prisma } = makePrisma({
      saved: [
        { slot: 'payment', body: 'Свой текст', revision: 3, updatedAt: new Date('2026-08-30') },
      ],
    });
    const res = await listCompanyTemplates(prisma, admin(), 'co-A');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(DOCUMENT_TEMPLATE_SLOTS.length);
    const payment = res.rows.find((r) => r.slot === 'payment')!;
    expect(payment).toMatchObject({ body: 'Свой текст', isCustom: true, revision: 3 });
    const liability = res.rows.find((r) => r.slot === 'liability')!;
    expect(liability.isCustom).toBe(false);
    expect(liability.revision).toBeNull();
    expect(liability.body).toContain('в соответствии с законодательством');
  });

  it('менеджер и клиентские роли не проходят гард; руководитель не читает чужую компанию', async () => {
    const { prisma } = makePrisma();
    expect(await listCompanyTemplates(prisma, manager(), 'co-A')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await listCompanyTemplates(prisma, leader(), 'co-B')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(prisma.documentTemplate.findMany).not.toHaveBeenCalled();
  });
});

describe('saveCompanyTemplate', () => {
  const args = { companyId: 'co-A', slot: 'payment', body: 'Оплата 100% предоплатой.' };

  it('счётчик компании и текст пишутся ОДНОЙ транзакцией, штамп попадает в строку', async () => {
    const { prisma, upsert, companyUpdate } = makePrisma();
    const res = await saveCompanyTemplate(prisma, admin(), args);
    expect(res).toEqual({ ok: true, revision: 4 });
    // Атомарный +1: чтение-и-запись дали бы двум одновременным правкам один
    // номер, и два разных текста стали бы неразличимы в документах.
    expect(companyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { documentTemplateRevision: { increment: 1 } } })
    );
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      create: { companyId: 'co-A', slot: 'payment', revision: 4 },
      update: { revision: 4 },
    });
  });

  it('в журнал идёт слот и редакция, но НЕ текст', async () => {
    const { prisma } = makePrisma();
    await saveCompanyTemplate(prisma, admin(), args);
    const call = recordAudit.mock.calls[0]![1];
    expect(call).toMatchObject({
      action: 'document_template_changed',
      entity: 'document_template',
      // Ключ записи — компания: по журналу видно, чью бумагу правили.
      entityId: 'co-A',
      after: { slot: 'payment', revision: 4 },
    });
    // Текст может содержать данные клиента — его в журнале быть не должно.
    expect(JSON.stringify(call)).not.toContain('предоплатой');
  });

  it('чужая компания у руководителя — отказ, а не молчаливая правка своей', async () => {
    const { prisma, upsert } = makePrisma();
    expect(await saveCompanyTemplate(prisma, leader(), { ...args, companyId: 'co-B' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('неизвестный слот, пустой текст и перебор длины отклоняются до базы', async () => {
    const { prisma, upsert } = makePrisma();
    expect(await saveCompanyTemplate(prisma, admin(), { ...args, slot: 'нет' })).toEqual({
      ok: false,
      error: 'unknown_slot',
    });
    expect(await saveCompanyTemplate(prisma, admin(), { ...args, body: '   ' })).toEqual({
      ok: false,
      error: 'text_empty',
    });
    expect(
      await saveCompanyTemplate(prisma, admin(), { ...args, body: 'x'.repeat(SLOT_TEXT_MAX + 1) })
    ).toEqual({ ok: false, error: 'text_too_long' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('неизвестная и потерянная обязательная подстановка отклоняются с перечнем', async () => {
    const { prisma } = makePrisma();
    expect(
      await saveCompanyTemplate(prisma, admin(), { ...args, body: 'Оплата {{нет.такого}}' })
    ).toEqual({ ok: false, error: 'unknown_placeholder', tokens: ['нет.такого'] });
    expect(
      await saveCompanyTemplate(prisma, admin(), {
        companyId: 'co-A',
        slot: 'term.contract',
        body: 'Договор бессрочный.',
      })
    ).toEqual({ ok: false, error: 'missing_placeholder', tokens: ['contract.term'] });
  });

  it('исчезнувшая компания — not_found, а не 500 из внешнего ключа', async () => {
    const { prisma, upsert } = makePrisma({ company: null });
    expect(await saveCompanyTemplate(prisma, admin(), args)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('resetCompanyTemplate', () => {
  it('УДАЛЯЕТ строку, а не пишет копию встроенного текста', async () => {
    const { prisma, deleteMany, upsert, companyUpdate } = makePrisma();
    expect(
      await resetCompanyTemplate(prisma, admin(), { companyId: 'co-A', slot: 'payment' })
    ).toEqual({ ok: true });
    expect(deleteMany).toHaveBeenCalledWith({ where: { companyId: 'co-A', slot: 'payment' } });
    expect(upsert).not.toHaveBeenCalled();
    // Счётчик растёт и на сбросе: документы до и после возврата к стандартному
    // тексту не должны выглядеть в журнале одинаково.
    expect(companyUpdate).toHaveBeenCalled();
    expect(recordAudit.mock.calls[0]![1]).toMatchObject({
      action: 'document_template_reset',
      after: { slot: 'payment' },
    });
  });

  it('чужая компания и неизвестный слот — отказ до базы', async () => {
    const { prisma, deleteMany } = makePrisma();
    expect(
      await resetCompanyTemplate(prisma, leader(), { companyId: 'co-B', slot: 'payment' })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(await resetCompanyTemplate(prisma, admin(), { companyId: 'co-A', slot: 'нет' })).toEqual(
      {
        ok: false,
        error: 'unknown_slot',
      }
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
