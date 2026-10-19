import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Страж service worker'а (`public/sw.js`), 19.10.2026.
 *
 * Страницы кабинета отдавались «сначала из кэша»: после обновления стенда
 * человек видел экран с прошлого визита, а после входа под другой ролью на
 * том же адресе — страницу предыдущего пользователя (воспроизведено на
 * стенде: руководитель открыл «Заказы» и увидел шапку `manager@demo.local`).
 *
 * Файл исполняется как есть, с подставными `self`, `caches` и `fetch`.
 */

const ORIGIN = 'https://lk.example';

function loadWorker() {
  const handlers: Record<string, (event: any) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const network: { reply: (url: string) => Promise<Response> } = {
    reply: () => Promise.resolve(new Response('')),
  };
  const keyOf = (req: any) => new URL(typeof req === 'string' ? req : req.url, ORIGIN).pathname;
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return {
        match: async (req: any) => c.get(keyOf(req))?.clone(),
        put: async (req: any, res: Response) => void c.set(keyOf(req), res),
        addAll: async (urls: string[]) => {
          for (const u of urls) c.set(keyOf(u), new Response(`cached ${u}`));
        },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: any) => void) => {
      handlers[type] = fn;
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const source = readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: (req: any) => network.reply(typeof req === 'string' ? req : req.url),
    URL,
    Headers,
    Response,
    Date,
    Promise,
  });

  async function run(type: string, extra: Record<string, unknown> = {}) {
    let waited: Promise<unknown> = Promise.resolve();
    let responded: Promise<Response> | undefined;
    handlers[type]!({
      ...extra,
      waitUntil: (p: Promise<unknown>) => (waited = p),
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    await waited;
    return responded;
  }
  const navigate = (pathname: string) =>
    run('fetch', {
      request: {
        method: 'GET',
        mode: 'navigate',
        url: `${ORIGIN}${pathname}`,
        headers: new Headers({ accept: 'text/html' }),
      },
    });
  return { run, navigate, network, store };
}

describe('sw.js: страницы кабинета не берутся из кэша', () => {
  it('второй заход на адрес показывает свежую страницу, а не сохранённую с прошлого раза', async () => {
    const sw = loadWorker();
    await sw.run('install');
    sw.network.reply = async () => new Response('страница manager@demo.local');
    const first = await sw.navigate('/manager/orders');
    expect(await first!.text()).toBe('страница manager@demo.local');

    sw.network.reply = async () => new Response('страница leader@demo.local');
    const second = await sw.navigate('/manager/orders');
    expect(await second!.text()).toBe('страница leader@demo.local');
  });

  it('страница кабинета не попадает ни в одно хранилище', async () => {
    const sw = loadWorker();
    await sw.run('install');
    sw.network.reply = async () => new Response('личные данные');
    await sw.navigate('/organization/orders');
    for (const cache of sw.store.values()) {
      expect([...cache.keys()]).not.toContain('/organization/orders');
    }
  });

  it('без сети — страница входа, а не чужая страница', async () => {
    const sw = loadWorker();
    await sw.run('install');
    sw.network.reply = async () => {
      throw new TypeError('Failed to fetch');
    };
    const res = await sw.navigate('/manager/orders');
    expect(await res!.text()).toBe('cached /login');
  });

  it('при активации стирает прежние хранилища вместе с сохранёнными страницами', async () => {
    const sw = loadWorker();
    // Хранилище прежней версии, в котором лежит страница кабинета.
    sw.store.set('otsfera-shell-v1', new Map([['/manager/orders', new Response('старое')]]));
    await sw.run('install');
    await sw.run('activate');
    expect(sw.store.has('otsfera-shell-v1')).toBe(false);
  });
});
