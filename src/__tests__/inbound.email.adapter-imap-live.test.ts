import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Live IMAP-адаптер (спека 2026-07-22-imap-live-adapter §5): imapflow и
 * mailparser замоканы — проверяется протокол курсора, фильтр IMAP-квирка
 * "n:*", батч, fallback текста, skip писем без from и гигиена соединения.
 */

const { state, ImapFlowMock, simpleParser } = vi.hoisted(() => {
  const state = {
    uidValidity: 7n as bigint,
    searchResult: [] as number[],
    // uid → сырой source (Buffer|null); parsed берётся из parsedByUid
    sources: new Map<number, Buffer | null>(),
    parsedByUid: new Map<number, unknown>(),
    connect: vi.fn(),
    logout: vi.fn(),
    close: vi.fn(),
    release: vi.fn(),
    search: vi.fn(),
    fetchOne: vi.fn(),
    lastOptions: null as unknown,
  };
  class ImapFlowMock {
    mailbox: { uidValidity: bigint };
    constructor(opts: unknown) {
      state.lastOptions = opts;
      this.mailbox = { uidValidity: state.uidValidity };
    }
    connect = state.connect;
    logout = state.logout;
    close = state.close;
    async getMailboxLock() {
      return { release: state.release };
    }
    search = state.search;
    fetchOne = state.fetchOne;
  }
  const simpleParser = vi.fn();
  return { state, ImapFlowMock, simpleParser };
});

vi.mock('imapflow', () => ({ ImapFlow: ImapFlowMock }));
vi.mock('mailparser', () => ({ simpleParser }));

import {
  ImapInboundEmailAdapter,
  parseCursor,
  bodyTextFrom,
} from '@/lib/inbound/email/adapter-imap';

const CFG = { host: 'imap.test', port: 143, user: 'u', password: 'p', tls: false };

function makeParsed(from: string | null, subject?: string, text?: string, html?: string | false) {
  return {
    from: from ? { value: [{ address: from }] } : undefined,
    subject,
    text,
    html: html ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.uidValidity = 7n;
  state.searchResult = [];
  state.sources.clear();
  state.parsedByUid.clear();
  state.connect.mockResolvedValue(undefined);
  state.logout.mockResolvedValue(undefined);
  state.search.mockImplementation(async () => state.searchResult);
  state.fetchOne.mockImplementation(async (uidStr: string) => {
    const uid = Number(uidStr);
    if (!state.sources.has(uid)) return null;
    return { uid, source: state.sources.get(uid) };
  });
  simpleParser.mockImplementation(async (src: Buffer) => {
    const uid = Number(src.toString());
    return state.parsedByUid.get(uid);
  });
});

function seed(uid: number, parsed: unknown) {
  state.sources.set(uid, Buffer.from(String(uid)));
  state.parsedByUid.set(uid, parsed);
}

describe('parseCursor', () => {
  it('null/чужое поколение/мусор → 0; своё поколение → uid', () => {
    expect(parseCursor(null, '7')).toBe(0);
    expect(parseCursor('6:41', '7')).toBe(0);
    expect(parseCursor('7:abc', '7')).toBe(0);
    expect(parseCursor('7:-2', '7')).toBe(0);
    expect(parseCursor('7:41', '7')).toBe(41);
  });
});

describe('bodyTextFrom', () => {
  it('text приоритетнее; html чистится от тегов; иначе пусто', () => {
    expect(bodyTextFrom('  hi  ', '<p>x</p>')).toBe('hi');
    expect(bodyTextFrom(undefined, '<p>Привет <b>мир</b></p>')).toBe('Привет мир');
    expect(bodyTextFrom('', false)).toBe('');
    expect(bodyTextFrom(undefined, '   ')).toBe('');
  });
});

describe('ImapInboundEmailAdapter.fetchNewMessages', () => {
  it('happy path: письма после курсора, DTO собраны, курсор продвинут, соединение закрыто', async () => {
    state.searchResult = [42, 43];
    seed(42, makeParsed('a@x.ru', 'Тема', 'тело', false));
    seed(43, makeParsed('b@x.ru', undefined, undefined, '<p>из html</p>'));

    const adapter = new ImapInboundEmailAdapter(CFG);
    const res = await adapter.fetchNewMessages('7:41');

    expect(res.messages).toEqual([
      { externalId: '7-42', from: 'a@x.ru', subject: 'Тема', text: 'тело' },
      { externalId: '7-43', from: 'b@x.ru', subject: undefined, text: 'из html' },
    ]);
    expect(res.cursor).toBe('7:43');
    expect(state.search).toHaveBeenCalledWith({ uid: '42:*' }, { uid: true });
    expect(state.release).toHaveBeenCalled();
    expect(state.logout).toHaveBeenCalled();
  });

  it('первый запуск без курсора: читает с UID 1', async () => {
    state.searchResult = [1];
    seed(1, makeParsed('a@x.ru', 's', 't'));
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages(null);
    expect(state.search).toHaveBeenCalledWith({ uid: '1:*' }, { uid: true });
    expect(res.cursor).toBe('7:1');
  });

  it('смена uidValidity сбрасывает курсор (старое поколение несравнимо)', async () => {
    state.uidValidity = 9n;
    state.searchResult = [1];
    seed(1, makeParsed('a@x.ru', 's', 't'));
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages('7:100');
    expect(state.search).toHaveBeenCalledWith({ uid: '1:*' }, { uid: true });
    expect(res.messages[0].externalId).toBe('9-1');
    expect(res.cursor).toBe('9:1');
  });

  it('IMAP-квирк: search по "n:*" вернул письмо ниже курсора — отфильтровано, курсор не откатывается', async () => {
    state.searchResult = [41]; // сервер вернул последнее письмо ящика, оно уже видено
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages('7:41');
    expect(res.messages).toEqual([]);
    expect(res.cursor).toBe('7:41');
    expect(state.fetchOne).not.toHaveBeenCalled();
  });

  it('батч ограничен 50 письмами, курсор — по максимуму обработанного', async () => {
    state.searchResult = Array.from({ length: 60 }, (_, i) => i + 1);
    for (let uid = 1; uid <= 60; uid++) seed(uid, makeParsed('a@x.ru', 's', 't'));
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages(null);
    expect(res.messages).toHaveLength(50);
    expect(res.cursor).toBe('7:50');
  });

  it('письмо без from пропускается, но курсор продвигается; fetchOne без source — тоже', async () => {
    state.searchResult = [42, 43, 44, 45, 46, 47];
    seed(42, makeParsed(null, 's', 't')); // нет блока from вовсе
    // 43 — fetchOne вернёт null (нет в sources)
    seed(44, { from: {}, subject: 's', text: 't', html: false }); // from без value
    seed(45, { from: { value: [{}] }, subject: 's', text: 't', html: false }); // адресат без address
    state.sources.set(46, null); // fetchOne вернул объект без source
    seed(47, makeParsed('c@x.ru', 's', 't'));
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages('7:41');
    expect(res.messages).toEqual([{ externalId: '7-47', from: 'c@x.ru', subject: 's', text: 't' }]);
    expect(res.cursor).toBe('7:47');
  });

  it('search вернул false (пустой ящик у некоторых серверов) — трактуется как пусто', async () => {
    state.search.mockResolvedValue(false);
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages('7:41');
    expect(res.messages).toEqual([]);
    expect(res.cursor).toBe('7:41');
  });

  it('неполный конфиг → понятный throw без попытки соединения', async () => {
    const adapter = new ImapInboundEmailAdapter({ ...CFG, password: undefined });
    await expect(adapter.fetchNewMessages(null)).rejects.toThrow('imap config incomplete');
    expect(state.connect).not.toHaveBeenCalled();
  });

  it('ошибка search: lock освобождён, logout вызван, ошибка пробрасывается', async () => {
    state.search.mockRejectedValue(new Error('server gone'));
    await expect(new ImapInboundEmailAdapter(CFG).fetchNewMessages(null)).rejects.toThrow(
      'server gone'
    );
    expect(state.release).toHaveBeenCalled();
    expect(state.logout).toHaveBeenCalled();
  });

  it('сбой logout гасится close() и не маскирует результат', async () => {
    state.searchResult = [];
    state.logout.mockRejectedValue(new Error('already closed'));
    const res = await new ImapInboundEmailAdapter(CFG).fetchNewMessages('7:41');
    expect(res.cursor).toBe('7:41');
    expect(state.close).toHaveBeenCalled();
  });

  it('tls=true даёт secure и дефолтный порт 993 при незаданном port', async () => {
    state.searchResult = [];
    await new ImapInboundEmailAdapter({
      host: 'h',
      user: 'u',
      password: 'p',
      tls: true,
    }).fetchNewMessages(null);
    expect(state.lastOptions).toMatchObject({ host: 'h', port: 993, secure: true });
  });

  it('tls=false без порта → дефолтный 143', async () => {
    state.searchResult = [];
    await new ImapInboundEmailAdapter({
      host: 'h',
      user: 'u',
      password: 'p',
      tls: false,
    }).fetchNewMessages(null);
    expect(state.lastOptions).toMatchObject({ port: 143, secure: false });
  });
});
