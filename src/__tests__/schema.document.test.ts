import { describe, expect, it, expectTypeOf } from 'vitest';
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
});
