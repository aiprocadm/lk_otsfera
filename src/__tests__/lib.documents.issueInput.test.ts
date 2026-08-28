import { describe, it, expect } from 'vitest';
import { issueInputSchema, toGenerateArgs } from '@/lib/documents/issueInput';

/**
 * `У-147` — одна схема входа на предпросмотр и выпуск. Разъедься они,
 * человек увидел бы один документ, а клиент получил бы другой.
 */
describe('issueInputSchema', () => {
  it('минимальный вход — заказ и тип', () => {
    expect(issueInputSchema.safeParse({ orderId: 'o1', docType: 'invoice' }).success).toBe(true);
  });

  it('чужой тип документа не проходит', () => {
    expect(issueInputSchema.safeParse({ orderId: 'o1', docType: 'waybill' }).success).toBe(false);
    expect(issueInputSchema.safeParse({ docType: 'invoice' }).success).toBe(false);
  });

  it('строка состава требует единицу из справочника', () => {
    const line = {
      title: 'Обучение',
      quantity: '1',
      unit: 'ящик',
      unitPrice: '100',
      discountPercent: null,
      vatRate: null,
      vatIncluded: true,
    };
    expect(
      issueInputSchema.safeParse({ orderId: 'o1', docType: 'invoice', lines: [line] }).success
    ).toBe(false);
    expect(
      issueInputSchema.safeParse({
        orderId: 'o1',
        docType: 'invoice',
        lines: [{ ...line, unit: 'person' }],
      }).success
    ).toBe(true);
  });
});

describe('toGenerateArgs', () => {
  it('даты разбираются, пустые поля НЕ появляются как undefined', () => {
    // `exactOptionalPropertyTypes`: сервис по отсутствию поля выбирает
    // поведение по умолчанию, поэтому «поля нет» и «поле undefined» — разное.
    const args = toGenerateArgs({
      orderId: 'o1',
      docType: 'act',
      documentDate: '2026-08-27',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
    });
    expect(args.extras!.documentDate).toBeInstanceOf(Date);
    expect(args.extras!.periodTo?.toISOString()).toContain('2026-08-31');
    expect('subject' in args.extras!).toBe(false);
    expect('lines' in args).toBe(false);
    expect('onAmountMismatch' in args).toBe(false);
  });

  it('мусор вместо даты игнорируется, а не превращается в «Invalid Date»', () => {
    const args = toGenerateArgs({ orderId: 'o1', docType: 'invoice', documentDate: 'вчера' });
    expect(args.extras).toBeUndefined();
  });

  it('пустой список строк не подменяет состав заказа', () => {
    // Пустой массив — это «строк не прислали», а не «документ без строк».
    expect('lines' in toGenerateArgs({ orderId: 'o1', docType: 'invoice', lines: [] })).toBe(false);
  });

  it('ответ на вопрос о суммах доезжает до сервиса', () => {
    const args = toGenerateArgs({
      orderId: 'o1',
      docType: 'invoice',
      onAmountMismatch: 'update_order',
    });
    expect(args.onAmountMismatch).toBe('update_order');
  });
});
