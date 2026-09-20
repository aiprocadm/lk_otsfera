import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Четыре тонких адаптера (§3): политики входа (`У-129`), «Принять» и
 * «Отправить» документ (`У-149`, `У-150`, `У-164`, `У-165`) и действия по
 * лиду (`У-161`, B3).
 *
 * У всех четырёх одна работа: разобрать форму, спросить право и **освежить
 * ровно те адреса, которые изменились**. Забытый адрес — не мелочь: человек
 * переходит по ссылке и видит прежнее состояние, будто действие не сработало.
 */
const mocks = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  requireSession: vi.fn(),
  requireManager: vi.fn(),
  saveSettings: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  acceptDocument: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  sendDocumentToCustomer: vi.fn(),
  sendDocumentsToClients: vi.fn(),
  pushLeadToOneC: vi.fn(),
  createOrganizationFromLead: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({
  requireSettingsSection: mocks.requireSettingsSection,
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireSession: mocks.requireSession,
  requireManager: mocks.requireManager,
}));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings: mocks.saveSettings }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  resetIntegrationSettingsCache: mocks.resetIntegrationSettingsCache,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/services/documents/accept', () => ({ acceptDocument: mocks.acceptDocument }));
vi.mock('@/lib/services/documents/acceptProposal', () => ({
  acceptProposal: mocks.acceptProposal,
}));
vi.mock('@/lib/services/documents/rejectProposal', () => ({
  rejectProposal: mocks.rejectProposal,
}));
vi.mock('@/lib/services/documents/send', () => ({
  sendDocumentToCustomer: mocks.sendDocumentToCustomer,
}));
vi.mock('@/lib/services/documents/sendMany', () => ({
  sendDocumentsToClients: mocks.sendDocumentsToClients,
}));
vi.mock('@/lib/services/manager/leadPush', () => ({ pushLeadToOneC: mocks.pushLeadToOneC }));
vi.mock('@/lib/services/leads/toOrganization', () => ({
  createOrganizationFromLead: mocks.createOrganizationFromLead,
}));

import { saveLoginPoliciesAction } from '@/server-actions/admin/loginPolicies';
import {
  acceptDocumentAction,
  acceptProposalAction,
  rejectProposalAction,
} from '@/server-actions/documents/accept';
import { sendDocumentAction, sendDocumentsToClientsAction } from '@/server-actions/documents/send';
import { pushLeadToOneCAction, createOrgFromLeadAction } from '@/server-actions/manager/leads';
import { LOGIN_POLICY_FIELDS } from '@/lib/auth/loginPolicyFields';

const SESSION = { sub: 'u1', role: 'admin', email: 'a@x.ru', companyId: 'c1' };

/** Форма со всеми полями политик входа; переданные значения перекрывают пустые. */
function policyForm(values: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const f of LOGIN_POLICY_FIELDS) fd.set(f.field, values[f.field] ?? '');
  return fd;
}

function docForm(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSettingsSection.mockResolvedValue(SESSION);
  mocks.requireSession.mockResolvedValue(SESSION);
  mocks.requireManager.mockResolvedValue(SESSION);
  mocks.saveSettings.mockResolvedValue({ ok: true });
});

describe('saveLoginPoliciesAction — политики входа', () => {
  it('пустые поля означают «вернуть значение сервера», а не ноль', async () => {
    const res = await saveLoginPoliciesAction(policyForm());

    expect(res).toEqual({ ok: true });
    const entries = mocks.saveSettings.mock.calls[0]?.[2] as Array<{ clear?: boolean }>;
    expect(entries).toHaveLength(LOGIN_POLICY_FIELDS.length);
    expect(entries.every((e) => e.clear === true)).toBe(true);
    expect(mocks.resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'login_policies_changed', entityId: 'platform' })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/security/login-policies');
  });

  it('число в границах сохраняется строкой', async () => {
    const first = LOGIN_POLICY_FIELDS[0]!;

    await saveLoginPoliciesAction(policyForm({ [first.field]: String(first.min) }));

    const entries = mocks.saveSettings.mock.calls[0]?.[2] as Array<{
      key: string;
      value?: string;
    }>;
    expect(entries[0]).toEqual({ key: first.key, value: String(first.min) });
  });

  it.each([
    ['ниже границы', (min: number) => String(min - 1)],
    ['выше границы', (_min: number, max: number) => String(max + 1)],
    ['не число', () => 'много'],
  ])('%s — отказ, и в базу ничего не уходит', async (_name, make) => {
    const first = LOGIN_POLICY_FIELDS[0]!;

    const res = await saveLoginPoliciesAction(
      policyForm({ [first.field]: make(first.min, first.max) })
    );

    expect(res).toEqual({ ok: false, error: 'value_out_of_range' });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('поле не строка — считается пустым, а не «NaN»', async () => {
    const fd = policyForm();
    fd.set(LOGIN_POLICY_FIELDS[0]!.field, new File(['x'], 'a.txt'));

    const res = await saveLoginPoliciesAction(fd);

    expect(res).toEqual({ ok: true });
  });

  it('отказ записи возвращается как есть — журнал и сброс кэша не трогаем', async () => {
    mocks.saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    const res = await saveLoginPoliciesAction(policyForm());

    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(mocks.resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe('Документы: «Принять» и «Отклонить»', () => {
  it('без номера документа — «не найден», сервис не зовём', async () => {
    await expect(acceptDocumentAction(docForm({}))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(mocks.acceptDocument).not.toHaveBeenCalled();
  });

  it('успех обновляет карточку в кабинете заказчика', async () => {
    mocks.acceptDocument.mockResolvedValue({ ok: true });

    const res = await acceptDocumentAction(docForm({ documentId: 'd1' }));

    expect(res).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organization/documents/d1');
  });

  it('отказ сервиса ничего не обновляет', async () => {
    mocks.acceptDocument.mockResolvedValue({ ok: false, error: 'forbidden' });

    await acceptDocumentAction(docForm({ documentId: 'd1' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('принятое предложение обновляет ТРИ адреса: две карточки и заказ', async () => {
    mocks.acceptProposal.mockResolvedValue({ ok: true, orderId: 'o9' });

    await acceptProposalAction(docForm({ documentId: 'd2' }));

    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/manager/documents/d2',
      '/organization/documents/d2',
      '/manager/orders/o9',
    ]);
  });

  it('предложение без номера — «не найдено»', async () => {
    await expect(acceptProposalAction(docForm({}))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('отказ принятия предложения адреса не трогает', async () => {
    mocks.acceptProposal.mockResolvedValue({ ok: false, error: 'conflict' });

    await acceptProposalAction(docForm({ documentId: 'd2' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('отклонение передаёт причину в сервис — проверять её здесь нельзя', async () => {
    mocks.rejectProposal.mockResolvedValue({ ok: true });

    await rejectProposalAction(docForm({ documentId: 'd3', reason: 'дорого' }));

    expect(mocks.rejectProposal).toHaveBeenCalledWith({}, SESSION, {
      documentId: 'd3',
      reason: 'дорого',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organization/documents/d3');
  });

  it('причины нет — уходит пустая строка, а правило остаётся в сервисе', async () => {
    mocks.rejectProposal.mockResolvedValue({ ok: false, error: 'reason_required' });

    const res = await rejectProposalAction(docForm({ documentId: 'd3' }));

    expect(mocks.rejectProposal).toHaveBeenCalledWith({}, SESSION, {
      documentId: 'd3',
      reason: '',
    });
    expect(res).toEqual({ ok: false, error: 'reason_required' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('отклонение без номера документа — «не найдено»', async () => {
    await expect(rejectProposalAction(docForm({}))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('Документы: «Отправить заказчику»', () => {
  it('без номера — «не найден»', async () => {
    await expect(sendDocumentAction(docForm({}))).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('успех обновляет карточку в обоих кабинетах сотрудников', async () => {
    mocks.sendDocumentToCustomer.mockResolvedValue({ ok: true });

    await sendDocumentAction(docForm({ documentId: 'd1' }));

    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/manager/documents/d1',
      '/leader/documents/d1',
    ]);
  });

  it('отказ ничего не обновляет', async () => {
    mocks.sendDocumentToCustomer.mockResolvedValue({ ok: false, error: 'forbidden' });

    await sendDocumentAction(docForm({ documentId: 'd1' }));

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('пачкой обновляются только те, что реально ушли', async () => {
    const fd = new FormData();
    fd.append('documentIds', 'a');
    fd.append('documentIds', 'b');
    fd.append('documentIds', '');
    mocks.sendDocumentsToClients.mockResolvedValue({
      ok: true,
      sent: 1,
      skipped: [{ documentId: 'b', reason: 'no_email' }],
    });

    await sendDocumentsToClientsAction(fd);

    expect(mocks.sendDocumentsToClients).toHaveBeenCalledWith({}, SESSION, ['a', 'b']);
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/manager/documents/a',
      '/leader/documents/a',
    ]);
  });

  it('никто не ушёл — не обновляем ничего', async () => {
    const fd = new FormData();
    fd.append('documentIds', 'a');
    mocks.sendDocumentsToClients.mockResolvedValue({ ok: true, sent: 0, skipped: [] });

    await sendDocumentsToClientsAction(fd);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('отказ пачки не обновляет ничего', async () => {
    mocks.sendDocumentsToClients.mockResolvedValue({ ok: false, error: 'forbidden' });

    await sendDocumentsToClientsAction(new FormData());

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('Лиды: отправка в 1С и создание организации', () => {
  it('пустой номер лида — отказ до похода в сервис', async () => {
    await expect(pushLeadToOneCAction({ leadId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(mocks.pushLeadToOneC).not.toHaveBeenCalled();
  });

  it('успех обновляет карточку лида', async () => {
    mocks.pushLeadToOneC.mockResolvedValue({ ok: true });

    const res = await pushLeadToOneCAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/manager/leads/l1');
  });

  it('уже отправляли — отказ возвращается как есть', async () => {
    mocks.pushLeadToOneC.mockResolvedValue({ ok: false, error: 'already_pushed' });

    const res = await pushLeadToOneCAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: false, error: 'already_pushed' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('кривой ввод организации из лида — отказ до сервиса', async () => {
    await expect(createOrgFromLeadAction({ leadId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(mocks.createOrganizationFromLead).not.toHaveBeenCalled();
  });

  it('успех обновляет ДВА адреса: карточку лида и новую организацию', async () => {
    mocks.createOrganizationFromLead.mockResolvedValue({ ok: true, organizationId: 'o5' });

    const res = await createOrgFromLeadAction({ leadId: 'l1', name: 'ООО «Новая»' });

    expect(res).toEqual({ ok: true, organizationId: 'o5' });
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/manager/leads/l1',
      '/manager/organizations/o5',
    ]);
  });

  it('отказ сервиса адреса не трогает', async () => {
    mocks.createOrganizationFromLead.mockResolvedValue({ ok: false, error: 'inn_taken' });

    const res = await createOrgFromLeadAction({ leadId: 'l1' });

    expect(res).toEqual({ ok: false, error: 'inn_taken' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
