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

  it('`У-145`: цель ровно одна — обе или ни одной схема не принимает', () => {
    expect(
      issueInputSchema.safeParse({ orderId: 'o1', organizationId: 'org-1', docType: 'invoice' })
        .success
    ).toBe(false);
    expect(issueInputSchema.safeParse({ docType: 'invoice' }).success).toBe(false);
    expect(
      issueInputSchema.safeParse({ organizationId: 'org-1', docType: 'invoice' }).success
    ).toBe(true);
  });

  it('`У-145`: организация доезжает до сервиса, а поля заказа не появляется', () => {
    const args = toGenerateArgs({ organizationId: 'org-1', docType: 'invoice' });
    expect(args.organizationId).toBe('org-1');
    // `exactOptionalPropertyTypes`: «поля нет» и «поле undefined» — разное.
    expect('orderId' in args).toBe(false);
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

/**
 * `У-161` (этап 7) — у документа появилась ТРЕТЬЯ цель: лид. Клиента ещё нет в
 * системе, поэтому у него нет ни заказа, ни организации, и коммерческое
 * предложение выставляют прямо лиду. Правило «цель ровно одна» с тремя полями
 * перестало быть простым «либо-либо», поэтому проверяем все комбинации.
 */
describe('issueInputSchema — коммерческое предложение и цель-лид (`У-161`)', () => {
  it('коммерческое предложение — допустимый тип документа', () => {
    // Не будь типа в справочнике, форма выпуска КП падала бы ещё на входе, до
    // всякой бизнес-логики.
    expect(
      issueInputSchema.safeParse({ leadId: 'l1', docType: 'commercial_proposal' }).success
    ).toBe(true);
    expect(
      issueInputSchema.safeParse({ orderId: 'o1', docType: 'commercial_proposal' }).success
    ).toBe(true);
  });

  it('лид — самостоятельная цель; пустая строка целью не считается', () => {
    expect(issueInputSchema.safeParse({ leadId: 'l1', docType: 'invoice' }).success).toBe(true);
    // Пустой `leadId` — это «цель не выбрана», а не «цель есть». Иначе форма
    // с незаполненным полем доехала бы до сервиса и он искал бы лида с пустым
    // идентификатором.
    expect(issueInputSchema.safeParse({ leadId: '', docType: 'invoice' }).success).toBe(false);
  });

  it('две цели сразу — отказ, в любой из трёх пар', () => {
    // Пара «заказ + лид» и «организация + лид» — это ровно те случаи, которые
    // прежнее правило «либо заказ, либо организация» пропускало бы: про лид
    // оно не знало вовсе, и документ ушёл бы неизвестно кому.
    const pairs = [
      { orderId: 'o1', organizationId: 'org-1' },
      { orderId: 'o1', leadId: 'l1' },
      { organizationId: 'org-1', leadId: 'l1' },
    ];
    for (const target of pairs) {
      expect(issueInputSchema.safeParse({ ...target, docType: 'invoice' }).success).toBe(false);
    }
  });

  it('все три цели сразу — отказ', () => {
    // Главный случай ради которого правило переписали на счётчик: цепочка
    // сравнений «либо-либо» на трёх полях такой вызов молча пропускает.
    expect(
      issueInputSchema.safeParse({
        orderId: 'o1',
        organizationId: 'org-1',
        leadId: 'l1',
        docType: 'invoice',
      }).success
    ).toBe(false);
  });

  it('ни одной цели — отказ, и жалоба привязана к полю цели', () => {
    const parsed = issueInputSchema.safeParse({ docType: 'commercial_proposal' });
    expect(parsed.success).toBe(false);
    // Жалоба без адреса не покажется в форме рядом с полем — человек увидит
    // «что-то не так» и не поймёт, что именно.
    expect(parsed.error!.issues.some((i) => i.path.includes('orderId'))).toBe(true);
  });
});

describe('toGenerateArgs — цель-лид (`У-161`)', () => {
  it('лид доезжает до сервиса, а полей заказа и организации не появляется', () => {
    const args = toGenerateArgs({ leadId: 'l1', docType: 'commercial_proposal' });
    expect(args.leadId).toBe('l1');
    // `exactOptionalPropertyTypes`: «поля нет» и «поле undefined» — разное, и
    // сервис выбирает цель именно по наличию поля.
    expect('orderId' in args).toBe(false);
    expect('organizationId' in args).toBe(false);
  });

  it('без лида поля `leadId` в аргументах нет вовсе', () => {
    // Пустой `leadId` рядом с заказом сервис счёл бы второй целью.
    const args = toGenerateArgs({ orderId: 'o1', docType: 'invoice' });
    expect('leadId' in args).toBe(false);
  });
});
