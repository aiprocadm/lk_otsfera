/**
 * Модульные тесты единой ленты «История» карточки организации
 * (`src/lib/services/organization/orgHistory.ts`; `У-184`, этап 1 ТЗ 12.09.2026,
 * спека §3.8).
 *
 * Доступ (`orgAccessibleForNotes`) подменён — политика заметок проверена своими
 * тестами; здесь важно лишь, что `null` даёт `not_found`, а `id` организации
 * берётся из ответа политики, не из аргументов. Флаги читаются настоящей
 * `isFeatureEnabled` через `process.env` (снапшот базы в модульном прогоне не
 * праймится), поэтому окружение сохраняется и восстанавливается вокруг каждого
 * теста. Prisma — ручной мок пяти источников с `findMany`/`count`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { orgAccessibleForNotes } = vi.hoisted(() => ({ orgAccessibleForNotes: vi.fn() }));
vi.mock('@/lib/services/organizationNotes/policy', () => ({ orgAccessibleForNotes }));

import {
  ORG_HISTORY_PAGE,
  isOrgHistoryType,
  listOrgHistory,
  orgHistoryTypesFor,
} from '@/lib/services/organization/orgHistory';

const ORIGINAL_ENV = { ...process.env };

const session = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;
/** Политика отвечает СВОИМ id — сервис обязан ходить в базу по нему, а не по аргументу. */
const ORG = { id: 'org-real', companyId: 'c1' };

type SourceMock = { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
type SourceName = 'auditLog' | 'organizationNote' | 'messengerDialog' | 'call' | 'inboundMessage';
const SOURCE_NAMES: SourceName[] = [
  'auditLog',
  'organizationNote',
  'messengerDialog',
  'call',
  'inboundMessage',
];

function source(rows: unknown[] = [], total = 0): SourceMock {
  return {
    findMany: vi.fn().mockResolvedValue(rows),
    count: vi.fn().mockResolvedValue(total),
  };
}

function makePrisma(over: Partial<Record<SourceName, SourceMock>> = {}) {
  const db: Record<SourceName, SourceMock> = {
    auditLog: source(),
    organizationNote: source(),
    messengerDialog: source(),
    call: source(),
    inboundMessage: source(),
    ...over,
  };
  return { db, prisma: db as unknown as PrismaClient };
}

const at = (iso: string) => new Date(iso);
const DESC_BY_CREATED_THEN_ID = [{ createdAt: 'desc' }, { id: 'desc' }];

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.FEATURE_INBOUND_MESSAGING = '1';
  process.env.FEATURE_TELEPHONY_MANGO = '1';
  orgAccessibleForNotes.mockReset().mockResolvedValue(ORG);
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('isOrgHistoryType', () => {
  it('знает пять типов ленты и отвергает всё остальное', () => {
    for (const key of ['audit', 'note', 'dialog', 'call', 'inbound']) {
      expect(isOrgHistoryType(key)).toBe(true);
    }
    expect(isOrgHistoryType('')).toBe(false);
    expect(isOrgHistoryType('notes')).toBe(false);
    expect(isOrgHistoryType('AUDIT')).toBe(false);
  });
});

describe('orgHistoryTypesFor — пилюли фильтра под флагами', () => {
  it('все флаги включены → пять типов в порядке реестра, без служебного поля flag', () => {
    expect(orgHistoryTypesFor(() => true)).toEqual([
      { key: 'audit', label: 'Журнал действий' },
      { key: 'note', label: 'Заметки' },
      { key: 'dialog', label: 'Диалоги' },
      { key: 'call', label: 'Звонки' },
      { key: 'inbound', label: 'Входящие письма' },
    ]);
  });

  it('все флаги выключены → остаются только журнал и заметки', () => {
    expect(orgHistoryTypesFor(() => false).map((t) => t.key)).toEqual(['audit', 'note']);
  });

  it('флаги независимы: телефония добавляет звонки, мессенджеры — диалоги и письма', () => {
    const onlyCalls = vi.fn((flag: string) => flag === 'telephony_mango');
    expect(orgHistoryTypesFor(onlyCalls).map((t) => t.key)).toEqual(['audit', 'note', 'call']);
    // Типы без флага у предиката не спрашиваются.
    expect(onlyCalls.mock.calls.map(([f]) => f)).toEqual([
      'inbound_messaging',
      'telephony_mango',
      'inbound_messaging',
    ]);

    expect(orgHistoryTypesFor((flag) => flag === 'inbound_messaging').map((t) => t.key)).toEqual([
      'audit',
      'note',
      'dialog',
      'inbound',
    ]);
  });
});

describe('listOrgHistory — доступ', () => {
  it('организация вне охвата → not_found, в базу за событиями не ходим', async () => {
    orgAccessibleForNotes.mockResolvedValue(null);
    const { db, prisma } = makePrisma();

    expect(await listOrgHistory(prisma, session, { orgId: 'org-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(orgAccessibleForNotes).toHaveBeenCalledWith(prisma, session, 'org-1');
    for (const name of SOURCE_NAMES) {
      expect(db[name].findMany).not.toHaveBeenCalled();
      expect(db[name].count).not.toHaveBeenCalled();
    }
  });

  it('размер страницы ленты — 20', () => {
    expect(ORG_HISTORY_PAGE).toBe(20);
  });
});

describe('listOrgHistory — точный режим (один тип)', () => {
  it('журнал действий: точные skip/take, порядок кончается id, подпись действия по-русски, актёр — сотрудник', async () => {
    const { db, prisma } = makePrisma({
      auditLog: source(
        [
          {
            id: 'a1',
            action: 'comment_posted',
            createdAt: at('2026-09-02T10:00:00Z'),
            user: { name: 'Иван' },
          },
          {
            id: 'a2',
            action: 'contact_archived',
            createdAt: at('2026-09-01T10:00:00Z'),
            user: null,
          },
        ],
        42
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'audit', skip: 20 });

    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: { entity: 'organization', entityId: 'org-real' },
      select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
      orderBy: DESC_BY_CREATED_THEN_ID,
      skip: 20,
      take: 20,
    });
    expect(db.auditLog.count).toHaveBeenCalledWith({
      where: { entity: 'organization', entityId: 'org-real' },
    });
    expect(res).toEqual({
      ok: true,
      mode: 'exact',
      total: 42,
      items: [
        {
          kind: 'audit',
          id: 'a1',
          at: at('2026-09-02T10:00:00Z'),
          title: 'Комментарий к заказу',
          subtitle: null,
          actor: 'Иван',
        },
        {
          kind: 'audit',
          id: 'a2',
          at: at('2026-09-01T10:00:00Z'),
          title: 'Контакт отправлен в архив',
          subtitle: null,
          actor: null,
        },
      ],
    });
    // Остальные источники в точном режиме не трогаются.
    for (const name of SOURCE_NAMES.filter((n) => n !== 'auditLog')) {
      expect(db[name].findMany).not.toHaveBeenCalled();
    }
  });

  it('смещение нормализуется: нет → 0, отрицательное → 0, дробное → вниз', async () => {
    const { db, prisma } = makePrisma();
    await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'audit' });
    await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'audit', skip: -5 });
    await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'audit', skip: 7.9 });
    expect(db.auditLog.findMany.mock.calls.map(([args]) => args.skip)).toEqual([0, 0, 7]);
  });

  it('заметки: текст в одну строку, длинный обрезается с «…», без автора — без актёра', async () => {
    const longBody = 'ж'.repeat(200);
    const { db, prisma } = makePrisma({
      organizationNote: source(
        [
          {
            id: 'n1',
            body: '  Первая\n\nстрока   и\tвторая  ',
            createdAt: at('2026-09-03T10:00:00Z'),
            author: { name: 'Мария' },
          },
          { id: 'n2', body: longBody, createdAt: at('2026-09-02T10:00:00Z'), author: null },
        ],
        2
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'note' });

    expect(db.organizationNote.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-real' },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: DESC_BY_CREATED_THEN_ID,
      skip: 0,
      take: 20,
    });
    expect(db.organizationNote.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-real' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0]).toEqual({
      kind: 'note',
      id: 'n1',
      at: at('2026-09-03T10:00:00Z'),
      title: 'Заметка',
      subtitle: 'Первая строка и вторая',
      actor: 'Мария',
    });
    const cut = res.items[1];
    expect(cut.actor).toBeNull();
    expect(cut.subtitle).toHaveLength(140);
    expect(cut.subtitle!.endsWith('…')).toBe(true);
    expect(cut.subtitle!.startsWith('ж'.repeat(139))).toBe(true);
  });

  it('диалоги: название канала по словарю, предпросмотр может отсутствовать, собеседник — контакт или подпись', async () => {
    const { db, prisma } = makePrisma({
      messengerDialog: source(
        [
          {
            id: 'd1',
            channel: 'telegram',
            lastMessageAt: at('2026-09-05T10:00:00Z'),
            lastMessagePreview: '  Добрый   день ',
            peerDisplay: '@ivan',
            contact: { name: 'Иван Петров' },
          },
          {
            id: 'd2',
            channel: 'sms',
            lastMessageAt: at('2026-09-04T10:00:00Z'),
            lastMessagePreview: null,
            peerDisplay: '+7 900 000-00-00',
            contact: null,
          },
          {
            id: 'd3',
            channel: 'max',
            lastMessageAt: at('2026-09-03T10:00:00Z'),
            lastMessagePreview: null,
            peerDisplay: null,
            contact: null,
          },
        ],
        3
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'dialog' });

    expect(db.messengerDialog.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-real' },
      select: {
        id: true,
        channel: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        peerDisplay: true,
        contact: { select: { name: true } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(db.messengerDialog.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-real' },
    });
    expect(res).toEqual({
      ok: true,
      mode: 'exact',
      total: 3,
      items: [
        {
          kind: 'dialog',
          id: 'd1',
          at: at('2026-09-05T10:00:00Z'),
          title: 'Диалог в Telegram',
          subtitle: 'Добрый день',
          actor: 'Иван Петров',
        },
        {
          kind: 'dialog',
          id: 'd2',
          at: at('2026-09-04T10:00:00Z'),
          // Неизвестный словарю канал показывается как есть, а не прячется.
          title: 'Диалог в sms',
          subtitle: null,
          actor: '+7 900 000-00-00',
        },
        {
          kind: 'dialog',
          id: 'd3',
          at: at('2026-09-03T10:00:00Z'),
          title: 'Диалог в MAX',
          subtitle: null,
          actor: null,
        },
      ],
    });
  });

  it('звонки: направление в заголовке, длительность в подписи, время — начало или запись', async () => {
    const { db, prisma } = makePrisma({
      call: source(
        [
          {
            id: 'c1',
            direction: 'out',
            callerNumber: '+7 900 111-11-11',
            startedAt: at('2026-09-05T09:00:00Z'),
            createdAt: at('2026-09-05T09:05:00Z'),
            durationSec: 65,
          },
          {
            id: 'c2',
            direction: 'in',
            callerNumber: '+7 900 222-22-22',
            startedAt: null,
            createdAt: at('2026-09-04T09:05:00Z'),
            durationSec: null,
          },
          {
            id: 'c3',
            direction: 'in',
            callerNumber: '+7 900 333-33-33',
            startedAt: at('2026-09-03T09:00:00Z'),
            createdAt: at('2026-09-03T09:05:00Z'),
            // Ноль секунд — это длительность, а не её отсутствие.
            durationSec: 0,
          },
        ],
        3
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'call' });

    expect(db.call.findMany).toHaveBeenCalledWith({
      where: { resolvedOrgId: 'org-real' },
      select: {
        id: true,
        direction: true,
        callerNumber: true,
        startedAt: true,
        createdAt: true,
        durationSec: true,
      },
      orderBy: DESC_BY_CREATED_THEN_ID,
      skip: 0,
      take: 20,
    });
    expect(db.call.count).toHaveBeenCalledWith({ where: { resolvedOrgId: 'org-real' } });
    expect(res).toEqual({
      ok: true,
      mode: 'exact',
      total: 3,
      items: [
        {
          kind: 'call',
          id: 'c1',
          at: at('2026-09-05T09:00:00Z'),
          title: 'Исходящий звонок',
          subtitle: '+7 900 111-11-11 · 65 с',
          actor: null,
        },
        {
          kind: 'call',
          id: 'c2',
          at: at('2026-09-04T09:05:00Z'),
          title: 'Входящий звонок',
          subtitle: '+7 900 222-22-22',
          actor: null,
        },
        {
          kind: 'call',
          id: 'c3',
          at: at('2026-09-03T09:00:00Z'),
          title: 'Входящий звонок',
          subtitle: '+7 900 333-33-33 · 0 с',
          actor: null,
        },
      ],
    });
  });

  it('входящие письма: тема или начало текста в заголовке, канал в подписи, отправитель — актёр', async () => {
    const { db, prisma } = makePrisma({
      inboundMessage: source(
        [
          {
            id: 'i1',
            channel: 'email',
            subject: '  Счёт за обучение  ',
            body: 'Добрый день, направляем счёт.',
            createdAt: at('2026-09-05T08:00:00Z'),
            senderDisplay: 'Анна',
          },
          {
            id: 'i2',
            channel: 'max',
            subject: '   ',
            body: '  Когда   будут\nудостоверения?  ',
            createdAt: at('2026-09-04T08:00:00Z'),
            senderDisplay: null,
          },
          {
            id: 'i3',
            channel: 'cabinet',
            subject: null,
            body: 'Вопрос из кабинета',
            createdAt: at('2026-09-03T08:00:00Z'),
            senderDisplay: 'Пётр',
          },
        ],
        3
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'inbound' });

    expect(db.inboundMessage.findMany).toHaveBeenCalledWith({
      where: { resolvedOrgId: 'org-real' },
      select: {
        id: true,
        channel: true,
        subject: true,
        body: true,
        createdAt: true,
        senderDisplay: true,
      },
      orderBy: DESC_BY_CREATED_THEN_ID,
      skip: 0,
      take: 20,
    });
    expect(db.inboundMessage.count).toHaveBeenCalledWith({ where: { resolvedOrgId: 'org-real' } });
    expect(res).toEqual({
      ok: true,
      mode: 'exact',
      total: 3,
      items: [
        {
          kind: 'inbound',
          id: 'i1',
          at: at('2026-09-05T08:00:00Z'),
          title: 'Счёт за обучение',
          subtitle: 'email',
          actor: 'Анна',
        },
        {
          kind: 'inbound',
          id: 'i2',
          at: at('2026-09-04T08:00:00Z'),
          // Пустая тема — заголовком становится начало текста.
          title: 'Когда будут удостоверения?',
          subtitle: 'MAX',
          actor: null,
        },
        {
          kind: 'inbound',
          id: 'i3',
          at: at('2026-09-03T08:00:00Z'),
          title: 'Вопрос из кабинета',
          subtitle: 'cabinet',
          actor: 'Пётр',
        },
      ],
    });
  });
});

describe('listOrgHistory — типы под выключенными флагами', () => {
  it('прямой адрес на тип под выключенным флагом отвечает пусто и в базу не ходит', async () => {
    delete process.env.FEATURE_TELEPHONY_MANGO;
    delete process.env.FEATURE_INBOUND_MESSAGING;
    const { db, prisma } = makePrisma({ call: source([{ id: 'c1' }], 1) });

    const empty = { ok: true, items: [], total: 0, mode: 'exact' };
    expect(await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'call' })).toEqual(empty);
    expect(await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'dialog' })).toEqual(
      empty
    );
    expect(await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'inbound' })).toEqual(
      empty
    );
    expect(db.call.findMany).not.toHaveBeenCalled();
    expect(db.messengerDialog.findMany).not.toHaveBeenCalled();
    expect(db.inboundMessage.findMany).not.toHaveBeenCalled();

    // Журнал и заметки флагами не гейтятся — работают как прежде.
    const notes = await listOrgHistory(prisma, session, { orgId: 'org-1', type: 'note' });
    expect(notes).toEqual({ ok: true, items: [], total: 0, mode: 'exact' });
    expect(db.organizationNote.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('listOrgHistory — режим «Все типы»', () => {
  it('каждый включённый источник берётся верхом (skip 0, take 50), total — сумма счётчиков', async () => {
    const { db, prisma } = makePrisma({
      auditLog: source([], 10),
      organizationNote: source([], 20),
      messengerDialog: source([], 30),
      call: source([], 40),
      inboundMessage: source([], 50),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1', skip: 20 });

    for (const name of SOURCE_NAMES) {
      expect(db[name].findMany).toHaveBeenCalledTimes(1);
      expect(db[name].findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
      expect(db[name].count).toHaveBeenCalledTimes(1);
    }
    expect(res).toEqual({ ok: true, items: [], total: 150, mode: 'top' });
  });

  it('события сливаются по времени (новые сверху), при равном времени — по id', async () => {
    const { prisma } = makePrisma({
      auditLog: source(
        [{ id: 'a1', action: 'comment_posted', createdAt: at('2026-09-01T10:00:00Z'), user: null }],
        1
      ),
      organizationNote: source(
        [{ id: 'n1', body: 'з', createdAt: at('2026-09-01T12:00:00Z'), author: null }],
        1
      ),
      messengerDialog: source(
        [
          {
            id: 'd1',
            channel: 'telegram',
            lastMessageAt: at('2026-09-01T11:00:00Z'),
            lastMessagePreview: null,
            peerDisplay: null,
            contact: null,
          },
        ],
        1
      ),
      call: source(
        [
          {
            id: 'c1',
            direction: 'in',
            callerNumber: '+7',
            startedAt: at('2026-09-01T12:00:00Z'),
            createdAt: at('2026-09-01T12:00:00Z'),
            durationSec: null,
          },
        ],
        1
      ),
      inboundMessage: source(
        [
          {
            id: 'i1',
            channel: 'email',
            subject: 'т',
            body: 'т',
            createdAt: at('2026-09-01T09:00:00Z'),
            senderDisplay: null,
          },
        ],
        1
      ),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1' });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('top');
    expect(res.total).toBe(5);
    // 12:00 у c1 и n1 — ничья, решает id: «c1» < «n1».
    expect(res.items.map((i) => i.id)).toEqual(['c1', 'n1', 'd1', 'a1', 'i1']);
  });

  it('страница — срез слитой ленты по 20: со смещением отдаёт хвост, за концом — пусто', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `a${String(i).padStart(2, '0')}`,
      action: 'comment_posted',
      createdAt: at(
        `2026-09-01T${String(23 - (i % 24)).padStart(2, '0')}:${i < 24 ? '00' : '30'}:00Z`
      ),
      user: null,
    }));
    const { prisma } = makePrisma({ auditLog: source(rows, 25) });

    const first = await listOrgHistory(prisma, session, { orgId: 'org-1' });
    const second = await listOrgHistory(prisma, session, { orgId: 'org-1', skip: 20 });
    const beyond = await listOrgHistory(prisma, session, { orgId: 'org-1', skip: 30 });

    expect(first.ok && first.items).toHaveLength(ORG_HISTORY_PAGE);
    expect(second.ok && second.items).toHaveLength(5);
    expect(beyond.ok && beyond.items).toEqual([]);
    // Счётчик один и тот же — по нему экран пишет «Показаны N из M».
    expect(first.ok && first.total).toBe(25);
    expect(second.ok && second.total).toBe(25);
  });

  it('выключенные флаги убирают источники из слияния целиком', async () => {
    delete process.env.FEATURE_TELEPHONY_MANGO;
    delete process.env.FEATURE_INBOUND_MESSAGING;
    const { db, prisma } = makePrisma({
      auditLog: source([], 3),
      organizationNote: source([], 4),
      messengerDialog: source([], 100),
      call: source([], 100),
      inboundMessage: source([], 100),
    });

    const res = await listOrgHistory(prisma, session, { orgId: 'org-1' });

    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(db.organizationNote.findMany).toHaveBeenCalledTimes(1);
    expect(db.messengerDialog.findMany).not.toHaveBeenCalled();
    expect(db.call.findMany).not.toHaveBeenCalled();
    expect(db.inboundMessage.findMany).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, items: [], total: 7, mode: 'top' });
  });
});
