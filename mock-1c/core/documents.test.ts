import { describe, it, expect } from 'vitest';
import { createDocumentStore } from './documents';
import { documentPushPayload } from '@/__tests__/helpers/oneCDocumentPush';

describe('createDocumentStore (этап 8, У-167 — приём выгрузки документов)', () => {
  it('accepts a valid document and answers 200 with a 1C externalId', () => {
    const store = createDocumentStore();
    const res = store.accept(documentPushPayload(), 0);
    expect(res.status).toBe(200);
    expect(res.result?.externalId).toMatch(/^mock-doc-\d+$/);
    expect(store.state()).toMatchObject({
      uniqueDocuments: 1,
      documents: [
        {
          externalId: 'doc-contract-1',
          type: 'invoice',
          number: 'С-2026-17',
          version: 1,
          attempts: 1,
          lines: 1,
        },
      ],
    });
    expect(store.state().lastBody?.externalId).toBe('doc-contract-1');
  });

  it('same externalId + same version is a no-op: same id back, one document, attempts=2', () => {
    const store = createDocumentStore();
    const first = store.accept(documentPushPayload(), 0);
    const second = store.accept(documentPushPayload({ number: 'другой номер' }), 0);
    expect(second.status).toBe(200);
    expect(second.result?.externalId).toBe(first.result?.externalId);
    const state = store.state();
    expect(state.uniqueDocuments).toBe(1);
    expect(state.documents[0]).toMatchObject({ attempts: 2, version: 1, number: 'С-2026-17' });
  });

  it('a higher version updates the stored document in place (same 1C id)', () => {
    const store = createDocumentStore();
    const first = store.accept(documentPushPayload(), 0);
    const res = store.accept(documentPushPayload({ version: 2, number: 'С-2026-18', lines: null }), 0);
    expect(res.status).toBe(200);
    expect(res.result?.externalId).toBe(first.result?.externalId);
    const state = store.state();
    expect(state.uniqueDocuments).toBe(1);
    expect(state.documents[0]).toMatchObject({ version: 2, number: 'С-2026-18', lines: null });
  });

  it('a lower version than accepted is rejected with 409 and does not overwrite', () => {
    const store = createDocumentStore();
    store.accept(documentPushPayload({ version: 3 }), 0);
    const res = store.accept(documentPushPayload({ version: 2, number: 'старый' }), 0);
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/version 2 is below accepted 3/);
    expect(store.state().documents[0]).toMatchObject({ version: 3, number: 'С-2026-17' });
  });

  it('distinct externalIds get distinct 1C ids', () => {
    const store = createDocumentStore();
    const a = store.accept(documentPushPayload({ externalId: 'a' }), 0);
    const b = store.accept(documentPushPayload({ externalId: 'b' }), 0);
    expect(a.result?.externalId).not.toBe(b.result?.externalId);
    expect(store.state().uniqueDocuments).toBe(2);
  });

  it('rejects a body without counterparty with 400 naming the field', () => {
    const store = createDocumentStore();
    const { counterparty: _dropped, ...withoutCounterparty } = documentPushPayload();
    void _dropped;
    const res = store.accept(withoutCounterparty, 0);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/^counterparty:/);
    expect(store.state().uniqueDocuments).toBe(0);
  });

  it('rejects a commercial proposal with 400 — КП в 1С не уходит (Р-14)', () => {
    const store = createDocumentStore();
    const res = store.accept({ ...documentPushPayload(), type: 'commercial_proposal' }, 0);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/^type:/);
  });

  it('rejects garbage (not an object) with 400 and a generic path', () => {
    const store = createDocumentStore();
    expect(store.accept('nope', 0)).toMatchObject({ status: 400, error: expect.stringMatching(/^body:/) });
    expect(store.accept(null, 0).status).toBe(400);
  });

  it('returns 500 when pushFailRate is 1 and records nothing', () => {
    const store = createDocumentStore();
    const res = store.accept(documentPushPayload(), 1);
    expect(res.status).toBe(500);
    expect(store.state().uniqueDocuments).toBe(0);
    expect(store.state().lastBody).toBeNull();
  });
});
