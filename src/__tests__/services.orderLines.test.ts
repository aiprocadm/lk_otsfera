/**
 * Этап 5 (`У-139`, `У-140`) — сервис строк заказа.
 *
 * Проверяем цепочку целиком (§16): доступ → «заказ из 1С» → валидация →
 * снимок суммы в строке → пересчёт `Order.totalAmount` → аудит. Особое
 * внимание трём местам, где ошибка не видна глазами:
 *   — клиент и партнёр отбиваются ДО запроса в базу (не «скрытой кнопкой»);
 *   — заказ с `externalId` не правится ни одним из мутаторов (сумма и строки
 *     принадлежат 1С);
 *   — ручная сумма (`totalAmountIsManual`) не откатывается следующей правкой
 *     строки.
 *
 * `canSeeOrder`/`getCompanyTeamVisibility` НЕ мокаются: скоуп менеджера — это
 * ровно то, что здесь проверяется, а мок превратил бы проверку в тавтологию.
 * Вместо этого подставляются настоящие поля заказа и режим команды компании.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type CatalogUnit, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  addOrderLine,
  buildLinesFromItems,
  listOrderLines,
  recalcOrderTotal,
  removeOrderLine,
  setOrderTotalManually,
  updateOrderLine,
  type OrderLineInput,
} from '@/lib/services/orders/orderLines';

// ---------------------------------------------------------------- сессии ----
const admin: SessionPayload = { sub: 'a1', role: 'admin' };
/** Рядовой менеджер, за которым закреплён заказ `ord-1`. */
const manager: SessionPayload = { sub: 'm1', role: 'manager', companyId: 'co-1' };
/** Менеджер той же компании, но заказ за ним не закреплён и оргов у него нет. */
const stranger: SessionPayload = { sub: 'm2', role: 'manager', companyId: 'co-1' };
const leader: SessionPayload = { sub: 'l1', role: 'leader', companyId: 'co-1' };
const client: SessionPayload = { sub: 'o1', role: 'organization', organizationId: 'org-1' };
const partner: SessionPayload = { sub: 'p1', role: 'partner', partnerId: 'pt-1' };

// ------------------------------------------------------------- фикстуры ----
const dec = (v: string) => new Prisma.Decimal(v);

type OrderRow = {
  id: string;
  externalId: string | null;
  totalAmount: Prisma.Decimal;
  totalAmountIsManual: boolean;
  companyId: string | null;
  managerId: string | null;
  organizationId: string | null;
  partnerId: string | null;
};

function orderRow(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'ord-1',
    externalId: null,
    totalAmount: dec('0'),
    totalAmountIsManual: false,
    companyId: 'co-1',
    managerId: 'm1',
    organizationId: 'org-1',
    partnerId: null,
    ...over,
  };
}

function lineRow(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    catalogItemId: null,
    title: 'Строка',
    quantity: dec('1.000'),
    unit: 'person' as CatalogUnit,
    unitPrice: dec('12000.00'),
    discountPercent: null as Prisma.Decimal | null,
    vatRate: dec('0.2000') as Prisma.Decimal | null,
    vatIncluded: true,
    amount: dec('12000.00'),
    sortOrder: 0,
    ...over,
  };
}

type Init = {
  order?: OrderRow | null;
  lines?: ReturnType<typeof lineRow>[];
  /** Строка, которую вернёт `orderLine.findUnique` (для update/remove). */
  line?: { orderId: string; title: string; amount: Prisma.Decimal } | null;
  items?: { directionId: string; direction: { id: string; name: string } | null }[];
  catalog?: {
    id: string;
    directionId: string;
    unit: CatalogUnit;
    price: Prisma.Decimal;
    vatRate: Prisma.Decimal | null;
    vatIncluded: boolean;
  }[];
  teamVisibility?: boolean;
};

/** Компания, которой принадлежит подставной каталог. */
const CATALOG_COMPANY = 'co-1';

/**
 * Мок-Prisma объектом. `order.findUnique` осознанно отдаёт ОДНУ строку на все
 * три чтения сервиса (загрузка заказа, чтение флага ручной суммы, companyId
 * для каталога): наборы полей у них не пересекаются по смыслу, а один объект
 * покрывает все три.
 */
function makePrisma(init: Init = {}) {
  const state = {
    order: init.order === undefined ? orderRow() : init.order,
    lines: init.lines ?? [],
    line: init.line ?? null,
    items: init.items ?? [],
    catalog: init.catalog ?? [],
    teamVisibility: init.teamVisibility ?? false,
  };
  const orderFindUnique = vi.fn(async () => state.order);
  const orderUpdate = vi.fn(async () => ({}));
  const lineFindMany = vi.fn(async () => state.lines);
  const lineFindUnique = vi.fn(async () => state.line);
  // Тип аргумента объявлен намеренно: без него `mock.calls[0][0]` — пустой
  // кортеж, и проверить, ЧТО именно ушло в базу, нельзя.
  const createdRows: { data: Record<string, unknown> }[] = [];
  const lineCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    createdRows.push(args);
    // Созданная строка попадает в состояние фейка: иначе последующий
    // пересчёт суммы «не видел» бы её и тест проверял бы пустоту.
    state.lines.push({
      id: `new-${state.lines.length + 1}`,
      catalogItemId: (args.data.catalogItemId as string | null) ?? null,
      title: String(args.data.title),
      quantity: dec(String(args.data.quantity)),
      unit: args.data.unit as 'person',
      unitPrice: dec(String(args.data.unitPrice)),
      discountPercent:
        args.data.discountPercent === null ? null : dec(String(args.data.discountPercent)),
      vatRate: args.data.vatRate === null ? null : dec(String(args.data.vatRate)),
      vatIncluded: Boolean(args.data.vatIncluded),
      amount: dec(String(args.data.amount)),
      sortOrder: Number(args.data.sortOrder),
    } as never);
    return { id: 'new-line' };
  });
  const lineUpdate = vi.fn(async () => ({}));
  const lineDelete = vi.fn(async () => ({}));
  // Ревью PR-4: сборка из позиций требует «строк ещё нет», ручная сумма —
  // «строки есть»; счётчик отвечает по текущему состоянию фейка.
  const lineCount = vi.fn(async () => state.lines.length);
  const itemFindMany = vi.fn(async () => state.items);
  // Фильтр каталога честный: иначе проверка «чужой каталог не притянется»
  // была бы тавтологией — мок вернул бы позиции при любом companyId.
  const catalogFindMany = vi.fn(
    async (args: { where: { companyId: string; directionId: { in: string[] } } }) => {
      const { companyId, directionId } = args.where;
      if (companyId !== CATALOG_COMPANY) return [];
      return state.catalog.filter((c) => directionId.in.includes(c.directionId));
    }
  );
  const companyFindUnique = vi.fn(async () => ({ managerTeamVisibility: state.teamVisibility }));
  // Ревью PR-4: ссылка на каталог обязана вести в каталог КОМПАНИИ ЗАКАЗА —
  // фейк отдаёт компанию элемента, чтобы проверку можно было провалить.
  const catalogFindUnique = vi.fn(async (args: { where: { id: string } }) =>
    args.where.id === 'foreign-item' ? { companyId: 'co-OTHER' } : { companyId: 'co-1' }
  );

  const prisma = {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    orderLine: {
      findMany: lineFindMany,
      findUnique: lineFindUnique,
      create: lineCreate,
      update: lineUpdate,
      delete: lineDelete,
      count: lineCount,
    },
    orderItem: { findMany: itemFindMany },
    catalogItem: { findMany: catalogFindMany, findUnique: catalogFindUnique },
    company: { findUnique: companyFindUnique },
  } as unknown as PrismaClient;

  return {
    prisma,
    state,
    createdRows,
    orderFindUnique,
    orderUpdate,
    lineFindMany,
    lineFindUnique,
    lineCreate,
    lineUpdate,
    lineDelete,
    lineCount,
    itemFindMany,
    catalogFindMany,
    catalogFindUnique,
    companyFindUnique,
  };
}

const VALID: OrderLineInput = {
  catalogItemId: null,
  title: 'Обучение по охране труда',
  quantity: '2',
  unit: 'person',
  unitPrice: '6000',
  discountPercent: null,
  vatRate: '0.20',
  vatIncluded: true,
  sortOrder: 0,
};

/** Строка, найденная `findUnique` перед правкой/удалением. */
const EXISTING = { orderId: 'ord-1', title: 'Старая строка', amount: dec('100.00') };

beforeEach(() => recordAuditMock.mockReset());

// ================================================================ доступ ====
describe('доступ к строкам заказа', () => {
  it('заказчик и партнёр отбиваются ДО запроса в базу — это гард, а не скрытая кнопка', async () => {
    const c = makePrisma();
    expect(await listOrderLines(c.prisma, client, 'ord-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await addOrderLine(c.prisma, partner, 'ord-1', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(c.orderFindUnique).not.toHaveBeenCalled();
    expect(c.lineCreate).not.toHaveBeenCalled();
  });

  it('менеджер вне своего скоупа → forbidden, хотя заказ той же компании', async () => {
    const c = makePrisma();
    expect(await listOrderLines(c.prisma, stranger, 'ord-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(c.companyFindUnique).toHaveBeenCalled();
  });

  it('при включённой видимости команды тот же менеджер заказ уже видит (C8)', async () => {
    const c = makePrisma({ teamVisibility: true });
    expect((await listOrderLines(c.prisma, stranger, 'ord-1')).ok).toBe(true);
  });

  it('руководитель без закреплённого заказа: режим команды выключен → forbidden, включён → доступ', async () => {
    const off = makePrisma();
    expect(await listOrderLines(off.prisma, leader, 'ord-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    const on = makePrisma({ teamVisibility: true });
    expect((await listOrderLines(on.prisma, leader, 'ord-1')).ok).toBe(true);
  });

  it('менеджер без компании не попадает в командный режим, даже если он включён у компании заказа', async () => {
    // Пустой companyId в сессии — не «видно всё», а обычный личный скоуп:
    // иначе сотрудник без компании читал бы чужие заказы.
    const noCompany: SessionPayload = { sub: 'm9', role: 'manager', companyId: null };
    const c = makePrisma({ teamVisibility: true });
    expect(await listOrderLines(c.prisma, noCompany, 'ord-1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(c.companyFindUnique).not.toHaveBeenCalled();
  });

  it('админ проходит без чтения режима команды (Model A)', async () => {
    const c = makePrisma();
    expect((await listOrderLines(c.prisma, admin, 'ord-1')).ok).toBe(true);
    expect(c.companyFindUnique).not.toHaveBeenCalled();
  });

  it('заказа нет → not_found у чтения и у всех мутаторов', async () => {
    const c = makePrisma({ order: null, line: EXISTING });
    const nf = { ok: false, error: 'not_found' };
    expect(await listOrderLines(c.prisma, admin, 'ord-X')).toEqual(nf);
    expect(await addOrderLine(c.prisma, admin, 'ord-X', VALID)).toEqual(nf);
    expect(await updateOrderLine(c.prisma, admin, 'l1', VALID)).toEqual(nf);
    expect(await removeOrderLine(c.prisma, admin, 'l1')).toEqual(nf);
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-X', '100')).toEqual(nf);
    expect(await recalcOrderTotal(c.prisma, admin, 'ord-X')).toEqual(nf);
    expect(await buildLinesFromItems(c.prisma, admin, 'ord-X')).toEqual(nf);
  });

  it('строки заказа нет → not_found, и загрузка заказа даже не начинается', async () => {
    const c = makePrisma({ line: null });
    expect(await updateOrderLine(c.prisma, admin, 'no-such', VALID)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await removeOrderLine(c.prisma, admin, 'no-such')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(c.orderFindUnique).not.toHaveBeenCalled();
  });

  it('чужой скоуп проверяется и на правке/удалении строки (обход по id строки закрыт)', async () => {
    const c = makePrisma({ line: EXISTING });
    expect(await updateOrderLine(c.prisma, stranger, 'l1', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await removeOrderLine(c.prisma, stranger, 'l1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(c.lineUpdate).not.toHaveBeenCalled();
    expect(c.lineDelete).not.toHaveBeenCalled();
  });
});

// ============================================================ заказ из 1С ====
describe('заказ из 1С (externalId) — только чтение', () => {
  const fromOneC = { order: orderRow({ externalId: '1c-0001' }), line: EXISTING };

  it('чтение показывает строки с признаком readOnly', async () => {
    const c = makePrisma({ ...fromOneC, lines: [lineRow()] });
    const res = await listOrderLines(c.prisma, admin, 'ord-1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.view.readOnly).toBe(true);
    expect(res.view.lines).toHaveLength(1);
  });

  it('ВСЕ мутаторы отвечают order_from_1c и в базу не пишут', async () => {
    const c = makePrisma(fromOneC);
    const ro = { ok: false, error: 'order_from_1c' };
    expect(await addOrderLine(c.prisma, admin, 'ord-1', VALID)).toEqual(ro);
    expect(await updateOrderLine(c.prisma, admin, 'l1', VALID)).toEqual(ro);
    expect(await removeOrderLine(c.prisma, admin, 'l1')).toEqual(ro);
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-1', '100')).toEqual(ro);
    expect(await recalcOrderTotal(c.prisma, admin, 'ord-1')).toEqual(ro);
    expect(await buildLinesFromItems(c.prisma, admin, 'ord-1')).toEqual(ro);

    expect(c.lineCreate).not.toHaveBeenCalled();
    expect(c.lineUpdate).not.toHaveBeenCalled();
    expect(c.lineDelete).not.toHaveBeenCalled();
    expect(c.orderUpdate).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

// ============================================================== валидация ====
describe('валидация строки', () => {
  it('каждая кривая величина даёт свою причину на русском, запись не идёт', async () => {
    const c = makePrisma();
    const res = await addOrderLine(c.prisma, admin, 'ord-1', {
      ...VALID,
      title: '   ',
      quantity: '1.2345',
      unitPrice: '10.123',
      discountPercent: '101',
      vatRate: '1.5',
      sortOrder: -1,
    });
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: [
        'Наименование: от 1 до 300 символов',
        'Количество: положительное число, максимум три знака после запятой',
        'Цена: неотрицательное число, максимум две цифры после запятой',
        'Скидка: от 0 до 100 процентов, максимум два знака после запятой',
        'Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»',
        'Порядок: целое число от 0 до 100000',
      ],
    });
    expect(c.lineCreate).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('наименование длиннее 300 символов отбивается так же, как пустое', async () => {
    const c = makePrisma();
    const res = await addOrderLine(c.prisma, admin, 'ord-1', { ...VALID, title: 'я'.repeat(301) });
    expect(res).toMatchObject({
      ok: false,
      messages: ['Наименование: от 1 до 300 символов'],
    });
  });

  it('нулевое количество проходит формат, но отбивается по смыслу', async () => {
    const c = makePrisma();
    expect(
      await addOrderLine(c.prisma, admin, 'ord-1', { ...VALID, quantity: '0' })
    ).toMatchObject({
      ok: false,
      messages: ['Количество: положительное число, максимум три знака после запятой'],
    });
  });

  it('нечисловые скидка и ставка НДС не проскакивают как NaN', async () => {
    const c = makePrisma();
    expect(
      await addOrderLine(c.prisma, admin, 'ord-1', {
        ...VALID,
        discountPercent: 'много',
        vatRate: 'НДС',
      })
    ).toMatchObject({
      ok: false,
      messages: [
        'Скидка: от 0 до 100 процентов, максимум два знака после запятой',
        'Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»',
      ],
    });
  });

  it('отрицательные скидка и ставка отбиваются', async () => {
    const c = makePrisma();
    expect(
      await addOrderLine(c.prisma, admin, 'ord-1', {
        ...VALID,
        discountPercent: '-5',
        vatRate: '-0.2',
      })
    ).toMatchObject({
      ok: false,
      messages: [
        'Скидка: от 0 до 100 процентов, максимум два знака после запятой',
        'Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»',
      ],
    });
  });

  it('порядок сортировки: дробный и запредельный отбиваются', async () => {
    const c = makePrisma();
    const msg = ['Порядок: целое число от 0 до 100000'];
    expect(
      await addOrderLine(c.prisma, admin, 'ord-1', { ...VALID, sortOrder: 1.5 })
    ).toMatchObject({ ok: false, messages: msg });
    expect(
      await addOrderLine(c.prisma, admin, 'ord-1', { ...VALID, sortOrder: 100_001 })
    ).toMatchObject({ ok: false, messages: msg });
  });

  it('валидация работает и на правке строки — не только на добавлении', async () => {
    const c = makePrisma({ line: EXISTING });
    expect(
      await updateOrderLine(c.prisma, admin, 'l1', { ...VALID, quantity: '0' })
    ).toMatchObject({
      ok: false,
      error: 'validation',
    });
    expect(c.lineUpdate).not.toHaveBeenCalled();
  });
});

// ====================================================== добавление строки ====
describe('добавление строки: нормализация, снимок суммы, пересчёт итога', () => {
  it('числа с пробелами и запятой приводятся к канону, количество — до трёх знаков', async () => {
    const c = makePrisma();
    const res = await addOrderLine(c.prisma, admin, 'ord-1', {
      ...VALID,
      quantity: '1 234,567',
      unitPrice: '1 234,56',
      discountPercent: '10,5',
      vatRate: '0.20',
    });
    expect(res).toEqual({ ok: true, id: 'new-line' });
    expect(c.lineCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'ord-1',
        title: 'Обучение по охране труда',
        quantity: '1234.567',
        unitPrice: '1234.56',
        discountPercent: '10.50',
        vatRate: '0.2000',
      }),
      select: { id: true },
    });
  });

  it('в amount пишется СНИМОК суммы, посчитанный на момент добавления', async () => {
    const c = makePrisma();
    await addOrderLine(c.prisma, admin, 'ord-1', VALID); // 2 × 6000
    expect(c.createdRows[0]!.data.amount).toBe('12000.00');
  });

  it('наименование обрезается по краям, «не облагается» сохраняется как null', async () => {
    const c = makePrisma();
    await addOrderLine(c.prisma, admin, 'ord-1', {
      ...VALID,
      title: '  Разработка документов  ',
      vatRate: null,
      discountPercent: null,
    });
    expect(c.createdRows[0]!.data).toMatchObject({
      title: 'Разработка документов',
      vatRate: null,
      discountPercent: null,
    });
  });

  it('после добавления Order.totalAmount пересчитывается из строк и флаг «вручную» снимается', async () => {
    // Две строки по 12 000 уже были, добавляем третью такую же: итог 36 000.
    // (Фейк кладёт созданную строку в состояние — иначе пересчёт «не видел»
    // бы только что добавленное и тест проверял бы не то.)
    const c = makePrisma({ lines: [lineRow(), lineRow({ id: 'l2', sortOrder: 1 })] });
    await addOrderLine(c.prisma, admin, 'ord-1', VALID);
    expect(c.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { totalAmount: '36000.00', totalAmountIsManual: false },
    });
  });

  it('услуга из каталога ЧУЖОЙ компании не принимается', async () => {
    // Ревью PR-4: подделанный catalogItemId привязал бы строку к прайсу чужой
    // компании, и этап 6 напечатал бы в документе чужую услугу.
    const c = makePrisma();
    const res = await addOrderLine(c.prisma, admin, 'ord-1', {
      ...VALID,
      catalogItemId: 'foreign-item',
    });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(c.lineCreate).not.toHaveBeenCalled();
  });

  it('услуга из каталога СВОЕЙ компании принимается', async () => {
    const c = makePrisma();
    const res = await addOrderLine(c.prisma, admin, 'ord-1', {
      ...VALID,
      catalogItemId: 'own-item',
    });
    expect(res).toMatchObject({ ok: true });
  });

  it('аудит записывает добавление строки с её сутью', async () => {
    const c = makePrisma();
    await addOrderLine(c.prisma, admin, 'ord-1', VALID);
    const audit = recordAuditMock.mock.calls[0]![1];
    expect(audit).toMatchObject({
      userId: 'a1',
      action: 'order_line_added',
      entity: 'order',
      entityId: 'ord-1',
      after: { title: 'Обучение по охране труда', quantity: '2.000', amount: '12000.00' },
    });
  });
});

// ================================================== правка и удаление ========
describe('правка и удаление строки', () => {
  it('правка пишет новые значения и аудит «было → стало»', async () => {
    const c = makePrisma({ line: EXISTING, lines: [lineRow()] });
    expect(await updateOrderLine(c.prisma, admin, 'l1', VALID)).toEqual({ ok: true });
    expect(c.lineUpdate).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: expect.objectContaining({ amount: '12000.00' }),
    });
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'order_line_updated',
      entityId: 'ord-1',
      before: { title: 'Старая строка', amount: '100.00' },
      after: { title: 'Обучение по охране труда', amount: '12000.00' },
    });
    expect(c.orderUpdate).toHaveBeenCalled();
  });

  it('удаление убирает строку, пересчитывает итог и пишет, что именно удалили', async () => {
    const c = makePrisma({ line: EXISTING, lines: [lineRow()] });
    expect(await removeOrderLine(c.prisma, admin, 'l1')).toEqual({ ok: true });
    expect(c.lineDelete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    expect(c.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { totalAmount: '12000.00', totalAmountIsManual: false },
    });
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'order_line_removed',
      before: { title: 'Старая строка', amount: '100.00' },
    });
  });

  it('удаление ПОСЛЕДНЕЙ строки обнуляет сумму заказа', async () => {
    // Ревью PR-4: раньше сумма оставалась от удалённой услуги, и вернуть её
    // было нечем — на карточке висела цена того, чего в заказе уже нет.
    const c = makePrisma({ line: EXISTING, lines: [] });
    expect(await removeOrderLine(c.prisma, admin, 'l1')).toEqual({ ok: true });
    expect(c.orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalAmount: '0.00', totalAmountIsManual: false } })
    );
  });

  it('если заказ исчез между удалением строки и пересчётом — просто ничего не пересчитываем', async () => {
    const c = makePrisma({ line: EXISTING, lines: [lineRow()] });
    c.orderFindUnique.mockResolvedValueOnce(orderRow()).mockResolvedValue(null as never);
    expect(await removeOrderLine(c.prisma, admin, 'l1')).toEqual({ ok: true });
    expect(c.orderUpdate).not.toHaveBeenCalled();
  });
});

// ==================================================== список и итоги ========
describe('список строк и итоги', () => {
  it('строки отдаются фиксированной точностью, итоги считаются по строкам', async () => {
    const c = makePrisma({
      order: orderRow({ totalAmount: dec('11800.00'), totalAmountIsManual: true }),
      lines: [
        lineRow({ discountPercent: dec('10.00') }),
        lineRow({
          id: 'l2',
          discountPercent: null,
          vatRate: null,
          unitPrice: dec('1000.00'),
          amount: dec('1000.00'),
          sortOrder: 1,
        }),
      ],
    });
    const res = await listOrderLines(c.prisma, manager, 'ord-1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.view.lines[0]).toEqual({
      id: 'l1',
      catalogItemId: null,
      title: 'Строка',
      quantity: '1.000',
      unit: 'person',
      unitPrice: '12000.00',
      discountPercent: '10.00',
      vatRate: '0.2000',
      vatIncluded: true,
      amount: '12000.00',
      sortOrder: 0,
    });
    expect(res.view.lines[1]).toMatchObject({ discountPercent: null, vatRate: null });
    // 12000 − 10% = 10800 (НДС внутри 1800) + 1000 без НДС.
    expect(res.view.totals).toEqual({ net: '10000.00', vat: '1800.00', gross: '11800.00' });
    expect(res.view).toMatchObject({
      readOnly: false,
      totalAmount: '11800.00',
      totalAmountIsManual: true,
    });
  });

  it('пустой заказ: строк нет, итоги нулевые — экран получает данные для пустого состояния', async () => {
    const c = makePrisma();
    const res = await listOrderLines(c.prisma, admin, 'ord-1');
    if (!res.ok) throw new Error('ожидался успех');
    expect(res.view.lines).toEqual([]);
    expect(res.view.totals).toEqual({ net: '0.00', vat: '0.00', gross: '0.00' });
  });
});

// ================================================= ручная сумма заказа ======
describe('ручная сумма заказа', () => {
  it('ручная сумма у заказа БЕЗ строк отбивается: там сумма-снимок из сделки', async () => {
    // Спека §3.3: ручная правка появляется только вместе со строками —
    // иначе рушится инвариант «сумма не меняется задним числом».
    const c = makePrisma({ lines: [] });
    const res = await setOrderTotalManually(c.prisma, admin, 'ord-1', '1000');
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(c.orderUpdate).not.toHaveBeenCalled();
  });

  it('сумма с пробелами и запятой принимается, флаг «вручную» поднимается, аудит пишет было→стало', async () => {
    // Ручная сумма разрешена только при наличии строк (спека §3.3) — поэтому
    // в заказе есть строка.
    const c = makePrisma({ order: orderRow({ totalAmount: dec('12000.00') }), lines: [lineRow()] });
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-1', ' 12 500,50 ')).toEqual({
      ok: true,
    });
    expect(c.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { totalAmount: '12500.50', totalAmountIsManual: true },
    });
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'order_total_set_manually',
      before: { totalAmount: '12000.00' },
      after: { totalAmount: '12500.50' },
    });
  });

  it('отрицательная, нечисловая и слишком дробная сумма отбиваются, в базу не пишем', async () => {
    const c = makePrisma();
    const bad = { ok: false, error: 'validation', messages: ['Сумма: неотрицательное число'] };
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-1', '-5')).toEqual(bad);
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-1', 'много')).toEqual(bad);
    expect(await setOrderTotalManually(c.prisma, admin, 'ord-1', '10.123')).toEqual(bad);
    expect(c.orderUpdate).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('ручную сумму НЕ откатывает следующая правка строк — иначе она молча терялась бы', async () => {
    const c = makePrisma({
      order: orderRow({ totalAmount: dec('777.00'), totalAmountIsManual: true }),
      lines: [lineRow()],
      line: EXISTING,
    });
    await addOrderLine(c.prisma, admin, 'ord-1', VALID);
    await updateOrderLine(c.prisma, admin, 'l1', VALID);
    await removeOrderLine(c.prisma, admin, 'l1');
    expect(c.orderUpdate).not.toHaveBeenCalled();
  });

  it('«пересчитать по строкам» пробивает флаг (force) и снимает его', async () => {
    const c = makePrisma({
      order: orderRow({ totalAmount: dec('777.00'), totalAmountIsManual: true }),
      lines: [lineRow()],
    });
    expect(await recalcOrderTotal(c.prisma, admin, 'ord-1')).toEqual({ ok: true });
    expect(c.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { totalAmount: '12000.00', totalAmountIsManual: false },
    });
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'order_total_recalculated',
      entityId: 'ord-1',
    });
  });

  it('«пересчитать» на заказе без строк снимает ручную пометку и обнуляет сумму', async () => {
    // Ревью PR-4: раньше это был холостой ход с зелёным тостом — заказ
    // застревал в состоянии «ручная сумма без строк», из которого нет выхода
    // (ручную сумму заново не поставить: строк нет).
    const c = makePrisma({ order: orderRow({ totalAmountIsManual: true }), lines: [] });
    expect(await recalcOrderTotal(c.prisma, admin, 'ord-1')).toEqual({ ok: true });
    expect(c.orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalAmount: '0.00', totalAmountIsManual: false } })
    );
  });
});

// ============================================ сборка строк из позиций =======
describe('сборка строк из позиций заказа', () => {
  const items = [
    { directionId: 'd1', direction: { id: 'd1', name: 'Охрана труда' } },
    { directionId: 'd1', direction: { id: 'd1', name: 'Охрана труда' } },
    { directionId: 'd2', direction: { id: 'd2', name: 'Пожарная безопасность' } },
    { directionId: 'd3', direction: null },
  ];
  const catalog = [
    {
      id: 'ci-1',
      directionId: 'd1',
      unit: 'person' as CatalogUnit,
      price: dec('6000.00'),
      vatRate: dec('0.2000'),
      vatIncluded: true,
    },
    {
      id: 'ci-3',
      directionId: 'd3',
      unit: 'service' as CatalogUnit,
      price: dec('500.00'),
      vatRate: null,
      vatIncluded: false,
    },
  ];

  it('позиций нет → понятная причина, а не молчаливый ноль строк', async () => {
    const c = makePrisma({ items: [] });
    expect(await buildLinesFromItems(c.prisma, admin, 'ord-1')).toEqual({
      ok: false,
      error: 'validation',
      messages: ['В заказе нет позиций — сначала добавьте слушателей.'],
    });
    expect(c.lineCreate).not.toHaveBeenCalled();
  });

  it('повторная сборка отбивается: строки уже есть — не удваиваем сумму', async () => {
    // Ревью PR-4: второй клик по «Собрать из позиций» дублировал строки.
    const c = makePrisma({ items, catalog, lines: [lineRow()] });
    const res = await buildLinesFromItems(c.prisma, admin, 'ord-1');
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(c.lineCreate).not.toHaveBeenCalled();
  });

  it('группирует по направлению, берёт цену из каталога, направление без цены даёт ноль И предупреждение', async () => {
    // Сборка — операция «собрать с нуля»: в заказе строк ещё нет (иначе
    // повторное нажатие удваивало бы сумму — ревью PR-4).
    const c = makePrisma({ items, catalog, lines: [] });
    const res = await buildLinesFromItems(c.prisma, admin, 'ord-1');
    expect(res).toEqual({ ok: true, created: 3, withoutPrice: ['Пожарная безопасность'] });

    expect(c.catalogFindMany.mock.calls[0]![0].where).toMatchObject({
      companyId: 'co-1',
      isActive: true,
      directionId: { in: ['d1', 'd2', 'd3'] },
    });

    const created = c.createdRows.map((row) => row.data);
    expect(created[0]).toMatchObject({
      orderId: 'ord-1',
      catalogItemId: 'ci-1',
      title: 'Охрана труда × 2 чел.',
      quantity: '2.000',
      unit: 'person',
      unitPrice: '6000.00',
      vatRate: '0.2000',
      vatIncluded: true,
      amount: '12000.00',
      sortOrder: 0,
    });
    // Направление без элемента каталога: строка есть, но цена нулевая.
    expect(created[1]).toMatchObject({
      catalogItemId: null,
      title: 'Пожарная безопасность × 1 чел.',
      unit: 'person',
      unitPrice: '0.00',
      vatRate: null,
      vatIncluded: true,
      amount: '0.00',
      sortOrder: 1,
    });
    // Элемент каталога без ставки НДС («не облагается») и со своей единицей.
    expect(created[2]).toMatchObject({
      catalogItemId: 'ci-3',
      title: 'Направление × 1 чел.',
      unit: 'service',
      unitPrice: '500.00',
      vatRate: null,
      vatIncluded: false,
      amount: '500.00',
      sortOrder: 2,
    });

    expect(c.orderUpdate).toHaveBeenCalled();
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'order_lines_built_from_items',
      after: { created: 3, withoutPrice: 1 },
    });
  });

  it('заказ исчез между проверкой доступа и чтением компании → каталог не подбирается ничей', async () => {
    // Подставной companyId '__none__' важнее, чем кажется: без него запрос
    // ушёл бы без фильтра компании и притянул чужой каталог.
    const c = makePrisma({ items, catalog });
    c.orderFindUnique.mockResolvedValueOnce(orderRow()).mockResolvedValue(null as never);
    const res = await buildLinesFromItems(c.prisma, admin, 'ord-1');
    expect(c.catalogFindMany.mock.calls[0]![0].where.companyId).toBe('__none__');
    expect(res).toEqual({
      ok: true,
      created: 3,
      withoutPrice: ['Охрана труда', 'Пожарная безопасность', 'Направление'],
    });
    expect(c.orderUpdate).not.toHaveBeenCalled();
  });
});
