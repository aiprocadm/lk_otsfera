/**
 * Этап 8 (PR-2) — actions генерации: флаг document_generation, валидация входа,
 * прокидка результата; requestRequisites: роль/скоуп, только org-недостающее.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  revalidatePath,
  isFeatureEnabled,
  generateOrderDocument,
  requestRequisites,
  resolveOrgIssueScope,
  resolveLeadIssueScope,
  getOrgDocumentIssuePanel,
  getLeadDocumentIssuePanel,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  isFeatureEnabled: vi.fn(),
  generateOrderDocument: vi.fn(),
  requestRequisites: vi.fn(),
  resolveOrgIssueScope: vi.fn(),
  resolveLeadIssueScope: vi.fn(),
  getOrgDocumentIssuePanel: vi.fn(),
  getLeadDocumentIssuePanel: vi.fn(),
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/services/documents/generate', () => ({ generateOrderDocument }));
vi.mock('@/lib/services/documents/requestRequisites', () => ({ requestRequisites }));
vi.mock('@/lib/services/documents/issueScope', () => ({
  resolveOrgIssueScope,
  resolveLeadIssueScope,
}));
vi.mock('@/lib/services/documents/generationPanel', () => ({
  getOrgDocumentIssuePanel,
  getLeadDocumentIssuePanel,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/db/prisma';
import {
  generateOrderDocumentAction,
  leadIssuePanelAction,
  orgIssuePanelAction,
  requestRequisitesAction,
} from '@/server-actions/documents/generate';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-A' };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

/**
 * `У-147`: форма выпуска шлёт поля ОДНИМ JSON-пакетом — той же схемой, что и
 * предпросмотр. Раньше действие читало плоские поля `orderId`/`docType`.
 */
function issueForm(payload: Record<string, unknown>): FormData {
  const fd = new FormData();
  fd.set('payload', JSON.stringify(payload));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireSession.mockResolvedValue(SESSION);
  requestRequisites.mockResolvedValue({ ok: true });
});

describe('generateOrderDocumentAction', () => {
  it('флаг выключен → forbidden без вызова сервиса', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(
      await generateOrderDocumentAction(issueForm({ orderId: 'o', docType: 'invoice' }))
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(generateOrderDocument).not.toHaveBeenCalled();
  });

  it('мусорный вход → not_found; успех ревалидирует деталку', async () => {
    // Ни пакета, ни валидного JSON, ни известного типа — сервис не зовём.
    expect(await generateOrderDocumentAction(form({ docType: 'invoice' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await generateOrderDocumentAction(form({ payload: '{не json' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      await generateOrderDocumentAction(issueForm({ orderId: 'o', docType: 'bogus' }))
    ).toEqual({ ok: false, error: 'not_found' });
    expect(generateOrderDocument).not.toHaveBeenCalled();

    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    const res = await generateOrderDocumentAction(
      issueForm({ orderId: 'ord-1', docType: 'invoice' })
    );
    expect(res).toEqual({ ok: true, documentId: 'd1', number: 'С-2026-1' });
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/ord-1');
  });

  it('`У-145`: выпуск без заказа обновляет карточку организации, а не адрес заказа', async () => {
    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd9', number: 'С-2026-9' });
    await generateOrderDocumentAction(
      issueForm({
        organizationId: 'org-1',
        docType: 'invoice',
        lines: [
          {
            title: 'Консультация',
            quantity: '1',
            unit: 'service',
            unitPrice: '1000',
            discountPercent: null,
            vatRate: null,
            vatIncluded: true,
          },
        ],
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/manager/organizations/org-1');
    expect(revalidatePath).not.toHaveBeenCalledWith('/manager/orders/undefined');
  });

  it('`У-147`: строки, дата и ответ о суммах доезжают до сервиса', async () => {
    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd3', number: 'С-2026-2' });
    await generateOrderDocumentAction(
      issueForm({
        orderId: 'ord-1',
        docType: 'act',
        documentDate: '2026-08-27',
        onAmountMismatch: 'keep_order',
        parentDocumentId: 'inv-7',
        lines: [
          {
            title: 'Обучение',
            quantity: '2',
            unit: 'person',
            unitPrice: '5000',
            discountPercent: null,
            vatRate: '0.2000',
            vatIncluded: true,
          },
        ],
      })
    );
    const args = generateOrderDocument.mock.calls[0]![2];
    expect(args.lines).toHaveLength(1);
    expect(args.onAmountMismatch).toBe('keep_order');
    expect(args.extras.parentDocumentId).toBe('inv-7');
    expect(args.extras.documentDate).toBeInstanceOf(Date);
  });

  it('PR-3: типы contract/extra_agreement принимаются', async () => {
    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd2', number: 'Д-2026-1' });
    expect(
      await generateOrderDocumentAction(issueForm({ orderId: 'ord-1', docType: 'contract' }))
    ).toEqual({
      ok: true,
      documentId: 'd2',
      number: 'Д-2026-1',
    });
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'contract',
    });

    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd3', number: 'ДС-2026-1' });
    await generateOrderDocumentAction(issueForm({ orderId: 'ord-1', docType: 'extra_agreement' }));
    expect(generateOrderDocument).toHaveBeenLastCalledWith(expect.anything(), SESSION, {
      orderId: 'ord-1',
      docType: 'extra_agreement',
    });
  });

  it('ошибка сервиса пробрасывается без ревалидации', async () => {
    generateOrderDocument.mockResolvedValue({ ok: false, error: 'invoice_required' });
    expect(
      await generateOrderDocumentAction(issueForm({ orderId: 'ord-1', docType: 'act' }))
    ).toEqual({
      ok: false,
      error: 'invoice_required',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('`У-161`: КП лиду обновляет карточку ЛИДА, а не «/manager/organizations/undefined»', async () => {
    generateOrderDocument.mockResolvedValue({ ok: true, documentId: 'd7', number: 'КП-2026-1' });

    await generateOrderDocumentAction(
      issueForm({
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        subject: 'Обучение бригады',
      })
    );

    // Целей у выпуска три. Пока веток было две, лид попадал в ветку
    // организации: адрес складывался из `undefined`, ошибки не было, но
    // страница лида не обновлялась — человек возвращался на карточку и не
    // видел там только что выпущенного предложения.
    expect(revalidatePath).toHaveBeenCalledWith('/manager/leads/lead-1');
    expect(revalidatePath).not.toHaveBeenCalledWith('/manager/organizations/undefined');
    // Заодно: цель-лид доезжает до сервиса, а не теряется по дороге.
    expect(generateOrderDocument).toHaveBeenCalledWith(expect.anything(), SESSION, {
      leadId: 'lead-1',
      docType: 'commercial_proposal',
      extras: { subject: 'Обучение бригады' },
    });
  });
});

// Скоуп, сбор недостающего и уведомление — в
// services.documents.requestRequisites.test.ts; здесь только адаптер.
describe('requestRequisitesAction', () => {
  it('делегирует в сервис после флага, гарда роли и разбора формы', async () => {
    const res = await requestRequisitesAction(form({ orderId: 'ord-1' }));
    expect(res).toEqual({ ok: true });
    expect(requestRequisites).toHaveBeenCalledWith(prisma, SESSION, { orderId: 'ord-1' });
  });

  it('без orderId в форме → not_found, сервис не зовём', async () => {
    expect(await requestRequisitesAction(new FormData())).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(requestRequisites).not.toHaveBeenCalled();
  });

  it('флаг off → forbidden; клиентская роль → forbidden; сервис не зовём', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();

    isFeatureEnabled.mockReturnValue(true);
    requireSession.mockResolvedValue({ sub: 'p', role: 'partner' });
    expect(await requestRequisitesAction(form({ orderId: 'o' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requestRequisites).not.toHaveBeenCalled();
  });

  it('admin проходит гард роли и доходит до сервиса', async () => {
    requireSession.mockResolvedValue({ sub: 'a1', role: 'admin' });
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({ ok: true });
    expect(requestRequisites).toHaveBeenCalledTimes(1);
  });

  it('not_found из сервиса прокидывается как есть', async () => {
    requestRequisites.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await requestRequisitesAction(form({ orderId: 'ord-1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

/**
 * `У-145` — данные формы выпуска без заказа. Гейт свой (флаг + скоуп
 * организации), потому что кнопка живёт в трёх кабинетах и на доске сделок:
 * скрытая кнопка запретом не является (§4).
 */
describe('orgIssuePanelAction', () => {
  beforeEach(() => {
    isFeatureEnabled.mockReturnValue(true);
    requireSession.mockResolvedValue(SESSION);
    resolveOrgIssueScope.mockResolvedValue({ ok: true, companyId: 'co-A' });
    getOrgDocumentIssuePanel.mockResolvedValue({ counterpartyName: 'ООО «Клиент»' });
  });

  it('выключенный флаг не пускает даже до сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await orgIssuePanelAction(form({ organizationId: 'org-1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();
  });

  it('без организации во входе — not_found, в базу не ходим', async () => {
    expect(await orgIssuePanelAction(new FormData())).toEqual({ ok: false, error: 'not_found' });
    expect(resolveOrgIssueScope).not.toHaveBeenCalled();
  });

  it('отказ скоупа прокидывается как есть, панель не считается', async () => {
    resolveOrgIssueScope.mockResolvedValue({ ok: false, error: 'org_no_company' });
    expect(await orgIssuePanelAction(form({ organizationId: 'org-1' }))).toEqual({
      ok: false,
      error: 'org_no_company',
    });
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
  });

  it('успех: панель считается по компании ИЗ организации, а не из формы', async () => {
    const res = await orgIssuePanelAction(form({ organizationId: 'org-1' }));
    expect(res).toEqual({ ok: true, panel: { counterpartyName: 'ООО «Клиент»' } });
    expect(getOrgDocumentIssuePanel).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
  });
});

/**
 * `У-161` — данные формы КП для ЛИДА. Кнопка живёт на карточке лида, но
 * запрет живёт здесь: скрытая кнопка запретом не является (§4).
 */
describe('leadIssuePanelAction', () => {
  const LEAD = {
    id: 'lead-1',
    clientCompanyName: 'ООО «Ромашка»',
    clientContactName: 'Иван Петров',
    organizationId: null,
    assignedManagerId: 'm1',
  };

  beforeEach(() => {
    resolveLeadIssueScope.mockResolvedValue({ ok: true, companyId: 'co-A', lead: LEAD });
    resolveOrgIssueScope.mockResolvedValue({ ok: true, companyId: 'co-B' });
    getLeadDocumentIssuePanel.mockResolvedValue({ counterpartyName: 'ООО «Ромашка»' });
    getOrgDocumentIssuePanel.mockResolvedValue({ counterpartyName: 'ООО «Ромашка» (юр. лицо)' });
  });

  it('выключенный флаг не пускает даже до сессии', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(await leadIssuePanelAction(form({ leadId: 'lead-1' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(resolveLeadIssueScope).not.toHaveBeenCalled();
  });

  it('без лида во входе — not_found, в базу не ходим', async () => {
    expect(await leadIssuePanelAction(new FormData())).toEqual({ ok: false, error: 'not_found' });
    expect(resolveLeadIssueScope).not.toHaveBeenCalled();
  });

  it('отказ гейта отдаётся как есть, панель не считается', async () => {
    // Отказавшийся клиент и клиент, уже ставший заказом, адресатами не
    // бывают: человеку нужно увидеть именно это, а не общее «нет доступа».
    resolveLeadIssueScope.mockResolvedValue({ ok: false, error: 'lead_not_active' });
    expect(await leadIssuePanelAction(form({ leadId: 'lead-1' }))).toEqual({
      ok: false,
      error: 'lead_not_active',
    });

    resolveLeadIssueScope.mockResolvedValue({ ok: false, error: 'no_company' });
    expect(await leadIssuePanelAction(form({ leadId: 'lead-1' }))).toEqual({
      ok: false,
      error: 'no_company',
    });

    expect(getLeadDocumentIssuePanel).not.toHaveBeenCalled();
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
  });

  it('лид без организации: панель лида, компания из гейта, адресат — клиент лида', async () => {
    const res = await leadIssuePanelAction(form({ leadId: 'lead-1' }));

    expect(res).toEqual({
      ok: true,
      panel: { counterpartyName: 'ООО «Ромашка»' },
      organizationId: null,
    });
    // Имя приходит из проверенного гейтом лида, а не из формы: подставить
    // чужое название параметрами нельзя.
    expect(getLeadDocumentIssuePanel).toHaveBeenCalledWith(prisma, {
      companyId: 'co-A',
      leadName: 'ООО «Ромашка»',
    });
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
  });

  it('у лида уже есть организация → форма целится в ОРГАНИЗАЦИЮ и называет её', async () => {
    resolveLeadIssueScope.mockResolvedValue({
      ok: true,
      companyId: 'co-A',
      lead: { ...LEAD, organizationId: 'org-7' },
    });

    const res = await leadIssuePanelAction(form({ leadId: 'lead-1' }));

    // Сервис выпуска в этом случае молча целится в организацию. Отдай форма
    // панель лида — человек увидел бы «предложение лиду», а бумага ушла бы
    // на организацию, и искал бы он её потом не там.
    expect(res).toEqual({
      ok: true,
      panel: { counterpartyName: 'ООО «Ромашка» (юр. лицо)' },
      organizationId: 'org-7',
    });
    // Компания берётся из скоупа ОРГАНИЗАЦИИ (co-B), а не из скоупа лида
    // (co-A): номер и реквизиты исполнителя принадлежат ей.
    expect(getOrgDocumentIssuePanel).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-7',
      companyId: 'co-B',
    });
    expect(getLeadDocumentIssuePanel).not.toHaveBeenCalled();
  });

  it('организация лида недоступна → not_found, а не панель лида в обход гейта', async () => {
    resolveLeadIssueScope.mockResolvedValue({
      ok: true,
      companyId: 'co-A',
      lead: { ...LEAD, organizationId: 'org-7' },
    });
    resolveOrgIssueScope.mockResolvedValue({ ok: false, error: 'org_no_company' });

    expect(await leadIssuePanelAction(form({ leadId: 'lead-1' }))).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(getOrgDocumentIssuePanel).not.toHaveBeenCalled();
    // Через лид «в обход» тоже не пускаем: иначе запрет на организацию
    // обходился бы одним лишним кликом.
    expect(getLeadDocumentIssuePanel).not.toHaveBeenCalled();
  });

  /*
   * Тест «гейт вернул успех без данных лида» снят намеренно.
   *
   * Он проверял ветку `scope.lead?.clientCompanyName ?? ''`, то есть отвечал
   * на вопрос «что будет, если гейт скажет „можно", но лида не отдаст».
   * Такого ответа больше не бывает: в типе `LeadIssueScope` лид объявлен
   * ОБЯЗАТЕЛЬНЫМ полем успеха, и подобный ответ не соберётся. Проверять
   * невозможное состояние — значит держать в коде ветку ради теста.
   */
});
