/**
 * Этап 6, PR-8a (`У-151`, дефекты `Д-3`/`Д-5`) — два тонких адаптера:
 *
 * - `setDocumentNumberAction` — вписать номер документу из 1С. Проверяем ровно
 *   адаптерное: сессию берёт сервер (не форма), поля формы приводятся к
 *   строкам, кэш карточки обновляется только на успехе и только в кабинете
 *   своей роли. Права и занятость номера живут в сервисе и проверены там.
 * - `reissuePanelAction` — данные формы перевыпуска. Здесь гейт СВОЙ и полный
 *   (флаг, роль, `canReadDocument`), потому что кнопка на карточке — это
 *   внешний вид, а не запрет (§4). Плюс правило «перевыпускается только живая
 *   наша бумага с номером» и выбор источника панели/строк.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  isFeatureEnabled,
  setDocumentNumber,
  canReadDocument,
  getDocumentGenerationPanel,
  getOrgDocumentIssuePanel,
  findUnique,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  isFeatureEnabled: vi.fn(),
  setDocumentNumber: vi.fn(),
  canReadDocument: vi.fn(),
  getDocumentGenerationPanel: vi.fn(),
  getOrgDocumentIssuePanel: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/documents/number', () => ({ setDocumentNumber }));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/generationPanel', () => ({
  getDocumentGenerationPanel,
  getOrgDocumentIssuePanel,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { document: { findUnique } } }));

import { prisma } from '@/lib/db/prisma';
import { setDocumentNumberAction } from '@/server-actions/documents/number';
import { reissuePanelAction } from '@/server-actions/documents/reissue';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireSession.mockResolvedValue(SESSION);
  canReadDocument.mockResolvedValue(true);
});

describe('setDocumentNumberAction', () => {
  it('успех: сервис зовётся с серверной сессией, кэш карточки обновляется в кабинете своей роли', async () => {
    // Роль для адреса ревалидации берётся из сессии, а не из формы: иначе
    // клиент мог бы попросить обновить чужой кабинет.
    requireSession.mockResolvedValue({ sub: 'l1', role: 'leader', companyId: 'co-A' });
    setDocumentNumber.mockResolvedValue({ ok: true });

    const res = await setDocumentNumberAction(form({ documentId: 'doc-1', number: 'С-2026-7' }));

    expect(res).toEqual({ ok: true });
    expect(setDocumentNumber).toHaveBeenCalledWith(
      prisma,
      { sub: 'l1', role: 'leader', companyId: 'co-A' },
      { documentId: 'doc-1', number: 'С-2026-7' }
    );
    expect(revalidatePath).toHaveBeenCalledWith('/leader/documents/doc-1');
  });

  it('нестроковые и пропущенные поля превращаются в пустую строку, а не в «[object File]»', async () => {
    // FormData отдаёт File, если в поле подсунули файл. Пустая строка — это
    // осознанный «пусто», сервис ответит на неё `invalid`, а не сохранит мусор.
    setDocumentNumber.mockResolvedValue({ ok: false, error: 'invalid' });
    const fd = new FormData();
    fd.set('number', new File(['x'], 'scan.pdf'));

    expect(await setDocumentNumberAction(fd)).toEqual({ ok: false, error: 'invalid' });
    expect(setDocumentNumber).toHaveBeenCalledWith(prisma, SESSION, {
      documentId: '',
      number: '',
    });
  });

  it('отказ сервиса прокидывается как есть и кэш не трогает', async () => {
    setDocumentNumber.mockResolvedValue({ ok: false, error: 'number_taken' });

    expect(
      await setDocumentNumberAction(form({ documentId: 'doc-1', number: 'С-2026-7' }))
    ).toEqual({ ok: false, error: 'number_taken' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/** Живой счёт заказа — база, от которой отступают остальные случаи. */
function orderDoc(over: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    type: 'invoice',
    number: 'С-2026-7',
    supersededAt: null,
    orderId: 'ord-1',
    companyId: 'co-A',
    counterpartyType: 'organization',
    counterpartyId: 'org-1',
    order: { companyId: 'co-A', organizationId: 'org-1' },
    lines: [
      {
        title: 'Обучение',
        quantity: '2',
        unit: 'person',
        unitPrice: '5000',
        discountPercent: '10',
        vatRate: '0.2000',
      },
    ],
    ...over,
  };
}

const ORDER_PANEL = {
  counterpartyName: 'ООО «Клиент»',
  missingByType: { invoice: [], act: [], contract: [], extra_agreement: [] },
  baseDocuments: [{ id: 'b1', type: 'invoice', number: 'С-2026-7', date: '2026-08-01' }],
  hasInvoice: true,
  hasContract: false,
  orderLines: [{ title: 'Из заказа', quantity: '1', unit: 'service', unitPrice: '100' }],
};

const ORG_PANEL = {
  counterpartyName: 'ООО «Клиент»',
  missingByType: { invoice: [], act: [], contract: [], extra_agreement: [] },
  baseDocuments: [],
  hasContract: true,
  catalog: [{ id: 'c1', title: 'Консультация' }],
};

describe('reissuePanelAction', () => {
  beforeEach(() => {
    getDocumentGenerationPanel.mockResolvedValue(ORDER_PANEL);
    getOrgDocumentIssuePanel.mockResolvedValue(ORG_PANEL);
  });

  it('выключенный флаг не пускает даже до сессии', async () => {
    // Флаг — это рубильник фичи целиком: пока он выключен, перевыпуска нет ни
    // у кого, и опрашивать сессию незачем.
    isFeatureEnabled.mockReturnValue(false);

    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(isFeatureEnabled).toHaveBeenCalledWith('document_generation');
    expect(requireSession).not.toHaveBeenCalled();
  });

  it('клиентская роль → forbidden, в базу не ходим; админ гейт роли проходит', async () => {
    requireSession.mockResolvedValue({ sub: 'p1', role: 'partner' });
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();

    requireSession.mockResolvedValue({ sub: 'a1', role: 'admin' });
    findUnique.mockResolvedValue(orderDoc());
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toMatchObject({ ok: true });
  });

  it('пустой documentId → not_found без похода в базу', async () => {
    expect(await reissuePanelAction(new FormData())).toEqual({ ok: false, error: 'not_found' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('документа нет → not_found', async () => {
    findUnique.mockResolvedValue(null);
    expect(await reissuePanelAction(form({ documentId: 'нет-такого' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'нет-такого' } })
    );
  });

  it('чужой документ → not_found (тот же предикат, что у скачивания)', async () => {
    // Отвечаем «не найдено», а не «нельзя»: иначе ответ подтверждал бы, что
    // документ с таким id существует.
    const doc = orderDoc();
    findUnique.mockResolvedValue(doc);
    canReadDocument.mockResolvedValue(false);

    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(canReadDocument).toHaveBeenCalledWith(SESSION, doc);
    expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
  });

  it('без номера, уже заменённый и «не наш» тип → not_reissuable', async () => {
    // Без номера перевыпускать нечего (сначала «Указать номер»), заменённую
    // версию заменяют не второй раз, а её преемницу, а чужую бумагу
    // (загруженный файл, тип `other`) мы вообще не выпускаем.
    findUnique.mockResolvedValue(orderDoc({ number: null }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });

    findUnique.mockResolvedValue(orderDoc({ supersededAt: new Date('2026-08-30T00:00:00Z') }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });

    findUnique.mockResolvedValue(orderDoc({ type: 'other' }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });

    expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
  });

  it('документ заказа: панель считается по заказу, строки — из снимка документа', async () => {
    // Снимок (`У-146`) — это то, что напечатано в заменяемой бумаге. Состав
    // заказа мог с тех пор поменяться, и подставлять его было бы подменой.
    findUnique.mockResolvedValue(orderDoc());

    const res = await reissuePanelAction(form({ documentId: 'doc-1' }));

    expect(getDocumentGenerationPanel).toHaveBeenCalledWith(prisma, {
      orderId: 'ord-1',
      companyId: 'co-A',
      organizationId: 'org-1',
    });
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      panel: {
        docType: 'invoice',
        target: { kind: 'order', orderId: 'ord-1' },
        counterpartyName: 'ООО «Клиент»',
        missingByType: ORDER_PANEL.missingByType,
        baseDocuments: ORDER_PANEL.baseDocuments,
        hasInvoice: true,
        hasContract: false,
        lines: [
          {
            title: 'Обучение',
            quantity: '2',
            unit: 'person',
            unitPrice: '5000',
            discountPercent: '10',
            vatRate: '0.2000',
            // Суммы в снимке уже посчитаны, поэтому «цена с НДС» повторно не
            // применяется — иначе НДС начислился бы дважды.
            vatIncluded: false,
          },
        ],
        catalog: [],
      },
    });
  });

  it('пустые скидка и ставка НДС в снимке остаются пустыми, а не «null»-строкой', async () => {
    findUnique.mockResolvedValue(
      orderDoc({
        lines: [
          {
            title: 'Консультация',
            quantity: '1',
            unit: 'service',
            unitPrice: '1000',
            discountPercent: null,
            vatRate: null,
          },
        ],
      })
    );

    const res = await reissuePanelAction(form({ documentId: 'doc-1' }));

    expect(res).toMatchObject({
      ok: true,
      panel: { lines: [expect.objectContaining({ discountPercent: null, vatRate: null })] },
    });
  });

  it('у документа заказа пустой снимок → форма открывается составом заказа', async () => {
    // Старые документы выпускались до снимка строк: лучше показать текущий
    // состав заказа, чем пустую форму.
    findUnique.mockResolvedValue(orderDoc({ lines: [] }));

    const res = await reissuePanelAction(form({ documentId: 'doc-1' }));

    expect(res).toMatchObject({ ok: true, panel: { lines: ORDER_PANEL.orderLines } });
  });

  it('документ БЕЗ заказа: панель организации, каталог из неё и hasInvoice=false', async () => {
    // Выпуск без заказа (`У-145`) — по организации: счета заказа тут ни при
    // чём, поэтому «счёт уже есть» всегда false, зато нужен каталог услуг.
    findUnique.mockResolvedValue(orderDoc({ orderId: null, order: null }));

    const res = await reissuePanelAction(form({ documentId: 'doc-1' }));

    expect(getOrgDocumentIssuePanel).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      panel: {
        docType: 'invoice',
        target: { kind: 'organization', organizationId: 'org-1' },
        counterpartyName: 'ООО «Клиент»',
        missingByType: ORG_PANEL.missingByType,
        baseDocuments: [],
        hasInvoice: false,
        hasContract: true,
        lines: [expect.objectContaining({ title: 'Обучение' })],
        catalog: ORG_PANEL.catalog,
      },
    });
  });

  it('заказ с половинчатой связкой → not_reissuable, а не тихий переезд в панель организации', async () => {
    // Заказ есть, но у него нет компании или организации. Уйти в ветку
    // «документ без заказа» значило бы молча потерять привязку документа к
    // заказу: человек перевыпустил бы бумагу, которая перестала быть заказной.
    findUnique.mockResolvedValue(orderDoc({ order: { companyId: null, organizationId: 'org-1' } }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });

    findUnique.mockResolvedValue(orderDoc({ order: { companyId: 'co-A', organizationId: null } }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });
    expect(getDocumentGenerationPanel).not.toHaveBeenCalled();
  });

  it('без заказа и без организации-владельца → not_reissuable', async () => {
    // Так выглядит вручную загруженный файл или сирота из 1С: перевыпускать
    // нечем — ни заказа с компанией, ни организации.
    findUnique.mockResolvedValue(orderDoc({ orderId: null, order: null, companyId: null }));
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });

    findUnique.mockResolvedValue(
      orderDoc({ orderId: null, order: null, counterpartyType: 'user' })
    );
    expect(await reissuePanelAction(form({ documentId: 'doc-1' }))).toEqual({
      ok: false,
      error: 'not_reissuable',
    });
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
  });
});
