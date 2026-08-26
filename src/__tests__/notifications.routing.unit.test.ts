import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowedChannels, listRoutingRules, ROUTABLE_CHANNELS } from '@/lib/notifications/routing';
import { NOTIFICATION_TYPES } from '@/lib/notifications/registry';

/**
 * `У-127`: правила маршрутизации. Главные инварианты — пустая таблица не
 * меняет поведение, компания перекрывает платформу, а не наоборот, и
 * уведомление в кабинете правилам не подчиняется.
 */
type Rule = {
  companyId: string | null;
  eventType: string;
  audience: string;
  channel: string;
  enabled: boolean;
};

function makeDb(rows: Rule[] = []) {
  return {
    notificationRule: {
      findMany: vi.fn().mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
        let out = rows;
        if (where?.eventType) out = out.filter((r) => r.eventType === where.eventType);
        if (where?.audience) out = out.filter((r) => r.audience === where.audience);
        return Promise.resolve(out);
      }),
    },
  } as never;
}

const EVENT = 'document_published';

beforeEach(() => vi.clearAllMocks());

describe('allowedChannels — пустая таблица ничего не меняет', () => {
  it('без правил ограничений нет', async () => {
    // `undefined`, а не полный список: «правил нет» и «правила разрешают всё»
    // — разные вещи. Список каналов может вырасти.
    expect(await allowedChannels(makeDb(), { eventType: EVENT, audience: 'organization' })).toBe(
      undefined
    );
  });

  it('правила, которые ничего не запрещают, тоже не ограничивают', async () => {
    const db = makeDb([
      {
        companyId: null,
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: true,
      },
    ]);
    expect(await allowedChannels(db, { eventType: EVENT, audience: 'organization' })).toBe(
      undefined
    );
  });
});

describe('allowedChannels — запреты', () => {
  it('выключенный канал исчезает из списка, остальные остаются', async () => {
    const db = makeDb([
      {
        companyId: null,
        eventType: EVENT,
        audience: 'organization',
        channel: 'telegram',
        enabled: false,
      },
    ]);
    const got = await allowedChannels(db, { eventType: EVENT, audience: 'organization' });
    expect(got).toEqual(['email', 'max', 'whatsapp']);
  });

  it('правило компании перекрывает платформенное', async () => {
    // Платформа запретила почту, компания вернула — должна победить компания.
    const db = makeDb([
      {
        companyId: null,
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: false,
      },
      {
        companyId: 'c1',
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: true,
      },
    ]);
    expect(
      await allowedChannels(db, { eventType: EVENT, audience: 'organization', companyId: 'c1' })
    ).toBe(undefined);
  });

  it('компания может запретить то, что платформа разрешила', async () => {
    const db = makeDb([
      {
        companyId: null,
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: true,
      },
      {
        companyId: 'c1',
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: false,
      },
    ]);
    const got = await allowedChannels(db, {
      eventType: EVENT,
      audience: 'organization',
      companyId: 'c1',
    });
    expect(got).not.toContain('email');
  });

  it('без компании читаются только платформенные правила', async () => {
    const db = makeDb();
    await allowedChannels(db, { eventType: EVENT, audience: 'organization' });
    const where = (db as never as { notificationRule: { findMany: ReturnType<typeof vi.fn> } })
      .notificationRule.findMany.mock.calls[0]![0].where;
    // Чужая компания не должна попасть в выборку даже случайно.
    expect(where.OR).toEqual([{ companyId: null }]);
  });
});

describe('сбой чтения правил не останавливает уведомления', () => {
  it('ошибка базы → доставляем по умолчанию, а не молчим', async () => {
    // Направление отказа выбрано осознанно: не пришедшее уведомление о новом
    // заказе хуже, чем пришедшее лишним каналом.
    const db = {
      notificationRule: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
    } as never;
    expect(await allowedChannels(db, { eventType: EVENT, audience: 'organization' })).toBe(
      undefined
    );
  });

  it('экран настроек при сбое показывает умолчания, а не пустую страницу', async () => {
    const db = {
      notificationRule: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
    } as never;
    const rows = await listRoutingRules(db, null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === 'default')).toBe(true);
  });
});

describe('уведомление в кабинете правилам не подчиняется', () => {
  it('in-app не входит в управляемые каналы', () => {
    // Запись уведомления — якорь защиты от повторов: без неё повторная
    // попытка прислала бы второе письмо.
    expect(ROUTABLE_CHANNELS as readonly string[]).not.toContain('inapp');
    expect([...ROUTABLE_CHANNELS]).toEqual(['email', 'telegram', 'max', 'whatsapp']);
  });
});

describe('listRoutingRules — таблица для экрана', () => {
  it('строки заводятся только для ролей, которым событие адресовано', async () => {
    const rows = await listRoutingRules(makeDb(), null);
    const expected = Object.values(NOTIFICATION_TYPES).reduce(
      (n, spec) => n + spec.audience.length * ROUTABLE_CHANNELS.length,
      0
    );
    expect(rows).toHaveLength(expected);
    // Иначе экран предложил бы настроить доставку роли, которой событие не идёт.
    for (const r of rows) {
      const spec = NOTIFICATION_TYPES[r.eventType as keyof typeof NOTIFICATION_TYPES];
      expect((spec.audience as readonly string[]).includes(r.audience)).toBe(true);
    }
  });

  it('без правил всё включено и помечено как «по умолчанию»', async () => {
    const rows = await listRoutingRules(makeDb(), null);
    expect(rows.every((r) => r.enabled)).toBe(true);
    expect(rows.every((r) => r.source === 'default')).toBe(true);
  });

  it('источник значения виден: платформа или компания', async () => {
    const db = makeDb([
      {
        companyId: null,
        eventType: EVENT,
        audience: 'organization',
        channel: 'email',
        enabled: false,
      },
      { companyId: 'c1', eventType: EVENT, audience: 'partner', channel: 'max', enabled: false },
    ]);
    const rows = await listRoutingRules(db, 'c1');
    const platform = rows.find(
      (r) => r.eventType === EVENT && r.audience === 'organization' && r.channel === 'email'
    );
    const own = rows.find(
      (r) => r.eventType === EVENT && r.audience === 'partner' && r.channel === 'max'
    );
    expect(platform?.source).toBe('platform');
    expect(platform?.enabled).toBe(false);
    expect(own?.source).toBe('company');
    expect(own?.enabled).toBe(false);
  });

  it('каждая строка несёт русское название события', () => {
    // Ключ вида `document_published` человеку ничего не говорит.
    for (const spec of Object.values(NOTIFICATION_TYPES)) {
      expect(spec.label.length).toBeGreaterThan(3);
    }
  });
});
