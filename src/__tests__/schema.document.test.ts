import { describe, expect, it, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '@prisma/client';

describe('Document model fields', () => {
  it('has type/direction/version/generationSource and nullable uploadedBy', () => {
    expectTypeOf<Document>().toHaveProperty('type');
    expectTypeOf<Document>().toHaveProperty('direction');
    expectTypeOf<Document>().toHaveProperty('version');
    expectTypeOf<Document>().toHaveProperty('replacesDocumentId');
    expectTypeOf<Document>().toHaveProperty('signedAt');
    expectTypeOf<Document>().toHaveProperty('generatedBy');
    expectTypeOf<Document>().toHaveProperty('externalId');
  });

  it('uploadedById is nullable to allow system-generated docs', () => {
    const sample: Document['uploadedById'] = null;
    expect(sample).toBeNull();
  });

  it('Document has counterpartyType + counterpartyId and CounterpartyType enum exists', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8'
    );
    expect(schema).toMatch(/enum CounterpartyType \{[\s\S]*organization[\s\S]*partner[\s\S]*\}/);
    expect(schema).toMatch(/counterpartyType\s+CounterpartyType/);
    expect(schema).toMatch(/counterpartyId\s+String/);
    expect(schema).toMatch(/@@index\(\[counterpartyType, counterpartyId\]\)/);
  });
});
