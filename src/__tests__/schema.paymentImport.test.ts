import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

describe('PaymentImport schema', () => {
  it('exposes PaymentImportBatch and PaymentImportRow models', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain('PaymentImportBatch');
    expect(models).toContain('PaymentImportRow');
  });

  it('PaymentImportRow.externalId is unique', () => {
    const row = Prisma.dmmf.datamodel.models.find((m) => m.name === 'PaymentImportRow')!;
    const ext = row.fields.find((f) => f.name === 'externalId')!;
    expect(ext.isUnique).toBe(true);
  });
});
