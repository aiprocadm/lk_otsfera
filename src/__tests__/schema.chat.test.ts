// src/__tests__/schema.chat.test.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

describe('chat schema', () => {
  it('exposes OrderThread / Message / ThreadReadState models', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain('OrderThread');
    expect(models).toContain('Message');
    expect(models).toContain('ThreadReadState');
  });

  it('OrderThread has a (orderId, side) unique', () => {
    const t = Prisma.dmmf.datamodel.models.find((m) => m.name === 'OrderThread')!;
    const uniq = t.uniqueIndexes.some(
      (u) => u.fields.length === 2 && u.fields.includes('orderId') && u.fields.includes('side')
    );
    expect(uniq).toBe(true);
  });

  it('ThreadSide enum has org and partner', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'ThreadSide')!;
    expect(e.values.map((v) => v.name).sort()).toEqual(['org', 'partner']);
  });

  it('Message несёт scanStatus с дефолтом none (антивирус вложений чата)', () => {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === 'Message')!;
    const scanStatus = m.fields.find((f) => f.name === 'scanStatus');
    expect(scanStatus).toBeDefined();
    expect(scanStatus!.type).toBe('String');
    expect(scanStatus!.default).toBe('none');
  });
});
