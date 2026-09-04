import http from 'node:http';
import {
  ENDPOINTS,
  SINCE_PARAM,
  PAGE_PARAM,
  EXTERNAL_ID_PARAM,
} from '@/lib/services/oneCSync/rest-wire';
import type { SyncCursor } from '@/lib/services/oneCSync/dto';
import type { ScenarioConfig } from './core/scenario';
import type { Dataset, Entity } from './core/dataset';
import { shapeResponse } from './core/serialize';
import { createLeadStore } from './core/leads';
import { createDocumentStore } from './core/documents';

export type ScenarioRef = { current: ScenarioConfig };

export type Mock1cDeps = {
  scenarioRef: ScenarioRef;
  token: string;
  dataset: Dataset;
  leadStore: ReturnType<typeof createLeadStore>;
  documentStore: ReturnType<typeof createDocumentStore>;
  log?: (msg: string) => void;
};

const PATH_TO_ENTITY: Record<string, Entity> = {
  [ENDPOINTS.organizations]: 'organization',
  [ENDPOINTS.orders]: 'order',
  [ENDPOINTS.payments]: 'payment',
  [ENDPOINTS.documents]: 'document',
};

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Маркер «тело не разобралось»: `null` — законный JSON, им сигналить нельзя.
const INVALID_JSON: unique symbol = Symbol('invalid-json');

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

export function createMock1cServer(deps: Mock1cDeps): http.Server {
  const log = deps.log ?? (() => {});

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      // --- introspection / control (no auth, dev-only) ---
      if (path === '/__health' && method === 'GET') return send(res, 200, { ok: true });
      if (path === '/__state' && method === 'GET') {
        return send(res, 200, {
          scenario: deps.scenarioRef.current,
          leads: deps.leadStore.state(),
          documents: deps.documentStore.state(),
        });
      }
      if (path === '/__control' && method === 'POST') {
        const raw = await readBody(req);
        try {
          const patch = JSON.parse(raw) as Partial<ScenarioConfig>;
          deps.scenarioRef.current = { ...deps.scenarioRef.current, ...patch };
          return send(res, 200, { scenario: deps.scenarioRef.current });
        } catch {
          return send(res, 400, { error: 'invalid JSON patch' });
        }
      }

      const scenario = deps.scenarioRef.current;

      // --- artificial latency (drives ONE_C_HTTP_TIMEOUT_MS) ---
      if (scenario.latencyMs > 0) await delay(scenario.latencyMs);

      // --- auth (Q2 Bearer) ---
      if (req.headers.authorization !== `Bearer ${deps.token}`) {
        return send(res, 401, { error: 'unauthorized' });
      }

      // --- failure injection on reads ---
      if (method === 'GET' && scenario.failMode !== 'none') {
        if (scenario.failMode === 'transient')
          return send(res, 503, { error: 'temporarily unavailable' }, { 'Retry-After': '1' });
        return send(res, 500, { error: 'permanent failure' });
      }

      // --- сверка (этап 8, `У-172`): один документ по externalId кабинета, контракт §7 ---
      const findExternalId = url.searchParams.get(EXTERNAL_ID_PARAM);
      if (path === ENDPOINTS.documents && method === 'GET' && findExternalId !== null) {
        const found = deps.documentStore.find(findExternalId);
        return send(res, 200, found ? [found] : []);
      }

      // --- pull endpoints ---
      const entity = PATH_TO_ENTITY[path];
      if (entity && method === 'GET') {
        const since = url.searchParams.get(SINCE_PARAM) ?? undefined;
        const pageRaw = url.searchParams.get(PAGE_PARAM);
        const offset = pageRaw && Number.isFinite(Number(pageRaw)) ? Number(pageRaw) : 0;
        const cursor: SyncCursor = since ? { since } : {};
        const records = deps.dataset.list(entity, cursor) as Array<Record<string, unknown>>;
        const { body, meta } = shapeResponse(records, scenario, offset);
        if (meta.pages > 1)
          log(
            `[mock1c] ${entity}: page at offset ${offset} (${meta.served}/${meta.total}), pages=${meta.pages}`
          );
        return send(res, 200, body);
      }

      // --- push lead ---
      if (path === ENDPOINTS.leadPush && method === 'POST') {
        const parsed = await readJson(req);
        if (parsed === INVALID_JSON) return send(res, 400, { error: 'invalid JSON' });
        const outcome = deps.leadStore.accept(
          parsed as Record<string, unknown>,
          scenario.pushFailRate
        );
        if (outcome.status !== 200) return send(res, outcome.status, { error: 'push failed' });
        return send(res, 200, outcome.result);
      }

      // --- push document (этап 8, `У-167`: тот же путь, что у GET, другой метод) ---
      if (path === ENDPOINTS.documentPush && method === 'POST') {
        const parsed = await readJson(req);
        if (parsed === INVALID_JSON) return send(res, 400, { error: 'invalid JSON' });
        const outcome = deps.documentStore.accept(parsed, scenario.pushFailRate);
        if (outcome.status !== 200) {
          log(`[mock1c] document push rejected ${outcome.status}: ${outcome.error}`);
          return send(res, outcome.status, { error: outcome.error });
        }
        return send(res, 200, outcome.result);
      }

      return send(res, 404, { error: `no mock route for ${method} ${path}` });
    } catch (err) {
      deps.log?.(`[mock1c] unhandled error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, { error: 'internal mock error' });
    }
  });
}
