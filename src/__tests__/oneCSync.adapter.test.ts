import { describe, it, expectTypeOf } from 'vitest';
import type { OneCAdapter } from '@/lib/services/oneCSync/adapter';

describe('OneCAdapter interface', () => {
  it('exposes the four pull methods and two pushes (lead, document)', () => {
    expectTypeOf<OneCAdapter['pullOrders']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullPayments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullDocuments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullOrganizations']>().toBeFunction();
    expectTypeOf<OneCAdapter['pushLead']>().toBeFunction();
    // Этап 8 (`У-167`): выгрузка документов — часть контракта адаптера, а не
    // приватный метод одного класса: очередь зовёт её через `getOneCAdapter()`.
    expectTypeOf<OneCAdapter['pushDocument']>().toBeFunction();
  });
});
