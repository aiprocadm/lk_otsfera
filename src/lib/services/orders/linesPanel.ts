import type { CatalogUnit, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listOrderLines, type OrderLinesView } from './orderLines';

/**
 * Этап 5 (`У-139`, `У-140`) — данные блока «Состав и стоимость» карточки
 * заказа: строки + каталог для подстановки.
 *
 * Зачем отдельный загрузчик, а не два вызова на каждой странице: карточка
 * заказа живёт в трёх кабинетах (admin / leader / manager), и «какой каталог
 * показывать» — решение одно на всех. Иначе оно расползлось бы по трём
 * страницам и разъехалось при первой же правке (тот же приём, что
 * `getDocumentGenerationPanel`).
 *
 * Скоуп каталога — **компания самого заказа**, а не сессии: `listOrderLines`
 * уже проверил доступ к заказу (admin ∨ контур сотрудников ЦО + `canSeeOrder`
 * с `teamMode`), а `companyId` читается из заказа, а не приходит из формы —
 * подменить его вызовом нельзя. Ролевого гарда каталога здесь поэтому нет:
 * он был бы вторым источником правды поверх уже пройденного гарда заказа.
 */

export type OrderCatalogOption = {
  id: string;
  name: string;
  code: string;
  unit: CatalogUnit;
  /** Decimal через границу server→client не проходит — строки. */
  price: string;
  vatRate: string | null;
  vatIncluded: boolean;
};

type OrderLinesPanelData = {
  view: OrderLinesView;
  catalog: OrderCatalogOption[];
};

/**
 * Каталог целиком, но не бесконечно: диалог строки ищет по названию/артикулу
 * на клиенте, а тащить в браузер десятки тысяч позиций незачем.
 */
const CATALOG_LIMIT = 500;

export async function getOrderLinesPanel(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<OrderLinesPanelData | null> {
  const lines = await listOrderLines(prisma, session, orderId);
  // Нет доступа или нет заказа — блока просто нет; страница уже показала
  // остальную карточку (или сама сделала notFound).
  if (!lines.ok) return null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { companyId: true },
  });
  const companyId = order?.companyId ?? null;
  // Заказ без компании (сироты старого импорта) — каталога нет, но строки
  // руками добавить можно: пустой список честнее отказа.
  const items = companyId
    ? await prisma.catalogItem.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          unit: true,
          price: true,
          vatRate: true,
          vatIncluded: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: CATALOG_LIMIT,
      })
    : [];

  return {
    view: lines.view,
    catalog: items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      unit: i.unit,
      price: i.price.toFixed(2),
      // Формат ставки — как у строк заказа (4 знака): предзаполнение диалога
      // сравнивается с текущим значением строки, разный формат ломал бы выбор.
      vatRate: i.vatRate === null ? null : i.vatRate.toFixed(4),
      vatIncluded: i.vatIncluded,
    })),
  };
}
