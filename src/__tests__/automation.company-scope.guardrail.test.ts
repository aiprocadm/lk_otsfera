import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

const { companyFindUnique } = vi.hoisted(() => ({ companyFindUnique: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findUnique: companyFindUnique } } }));

const { createAutomationRule, updateAutomationRule, toggleAutomationRule, deleteAutomationRule } =
  vi.hoisted(() => ({
    createAutomationRule: vi.fn(),
    updateAutomationRule: vi.fn(),
    toggleAutomationRule: vi.fn(),
    deleteAutomationRule: vi.fn(),
  }));
vi.mock('@/lib/services/automation/rules', () => ({
  createAutomationRule,
  updateAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
}));

import {
  createAutomationRuleAction,
  updateAutomationRuleAction,
  toggleAutomationRuleAction,
  deleteAutomationRuleAction,
} from '@/server-actions/admin/automationRules';

/**
 * СТРАЖ `У-227`: правило чужой компании не трогается и не срабатывает.
 *
 * Здесь проверяется самая опасная половина — **кто чьи правила правит**. Робот
 * ставит людям задачи и пишет им сообщения; правило, заведённое в чужой
 * компании, — это не «немного не тот список на экране», а чужая работа и чужие
 * уведомления.
 *
 * Ключевое: у руководителя компания берётся ИЗ СЕССИИ, а не из формы. Если бы
 * её присылала форма, руководитель одной компании переписал бы правила другой,
 * поменяв одно поле. У администратора компания приходит из формы — но её
 * существование проверяет база, а не доверие к строке.
 *
 * Мутация (проверено 15.09.2026): заставить `scopeOf` у руководителя брать
 * `companyIdFromForm` → первый тест краснеет.
 */

const VALID = {
  name: 'Правило',
  trigger: 'document_issued',
  actions: [
    { kind: 'create_task' as const, titleTemplate: 'Дело', assignee: 'responsible_manager' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  createAutomationRule.mockResolvedValue({ ok: true, id: 'r1' });
  updateAutomationRule.mockResolvedValue({ ok: true, id: 'r1' });
  toggleAutomationRule.mockResolvedValue({ ok: true });
  deleteAutomationRule.mockResolvedValue({ ok: true });
  companyFindUnique.mockResolvedValue({ id: 'co-admin-pick' });
});

describe('страж: чьи правила правим', () => {
  it('РУКОВОДИТЕЛЬ работает с компанией ИЗ СЕССИИ, а не из формы', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: 'co-своя' });
    // В форму подсунут ЧУЖОЙ идентификатор — он обязан быть проигнорирован.
    await createAutomationRuleAction('leader', 'co-чужая', VALID);
    expect(createAutomationRule.mock.calls[0][1].companyId).toBe('co-своя');
  });

  it('руководитель БЕЗ компании не правит ничего', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: null });
    const res = await createAutomationRuleAction('leader', 'co-чужая', VALID);
    expect(res).toEqual({ ok: false, error: 'company_required' });
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  it('АДМИНИСТРАТОР выбирает компанию, и её существование проверяет база', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'admin', companyId: null });
    await createAutomationRuleAction('admin', 'co-admin-pick', VALID);
    expect(companyFindUnique).toHaveBeenCalled();
    expect(createAutomationRule.mock.calls[0][1].companyId).toBe('co-admin-pick');
  });

  it('администратор с ВЫДУМАННОЙ компанией получает отказ, а не пустой экран', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'admin', companyId: null });
    companyFindUnique.mockResolvedValue(null);
    const res = await createAutomationRuleAction('admin', 'нет-такой', VALID);
    expect(res).toEqual({ ok: false, error: 'company_required' });
    expect(createAutomationRule).not.toHaveBeenCalled();
  });

  it('администратор БЕЗ выбранной компании не правит платформу — платформенных правил нет', async () => {
    // Отличие от правил уведомлений (`У-127`), где `companyId = null` означает
    // «правило платформы». Робот, создающий задачи сразу во всех компаниях, —
    // не функция, а происшествие.
    requireSettingsSection.mockResolvedValue({ sub: 'admin', companyId: null });
    const res = await createAutomationRuleAction('admin', null, VALID);
    expect(res).toEqual({ ok: false, error: 'company_required' });
  });

  it.each([
    [
      'изменение',
      () => updateAutomationRuleAction('leader', 'co-чужая', 'r1', VALID),
      updateAutomationRule,
    ],
    [
      'включение',
      () => toggleAutomationRuleAction('leader', 'co-чужая', 'r1', true),
      toggleAutomationRule,
    ],
    [
      'удаление',
      () => deleteAutomationRuleAction('leader', 'co-чужая', 'r1'),
      deleteAutomationRule,
    ],
  ])('%s тоже берёт компанию из сессии, а не из формы', async (_name, call, spy) => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: 'co-своя' });
    await call();
    expect(spy.mock.calls[0][1].companyId).toBe('co-своя');
  });

  it.each([
    [
      'изменение',
      () => updateAutomationRuleAction('leader', null, 'r1', VALID),
      updateAutomationRule,
    ],
    [
      'включение',
      () => toggleAutomationRuleAction('leader', null, 'r1', true),
      toggleAutomationRule,
    ],
    ['удаление', () => deleteAutomationRuleAction('leader', null, 'r1'), deleteAutomationRule],
  ])('%s без компании в сессии — отказ и ни одного вызова сервиса', async (_n, call, spy) => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: null });
    const res = await call();
    expect(res).toEqual({ ok: false, error: 'company_required' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('КАЖДОЕ действие проходит через гард раздела — скрытая карточка это не защита', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: 'co-своя' });
    await createAutomationRuleAction('leader', null, VALID);
    await updateAutomationRuleAction('leader', null, 'r1', VALID);
    await toggleAutomationRuleAction('leader', null, 'r1', true);
    await deleteAutomationRuleAction('leader', null, 'r1');
    expect(requireSettingsSection).toHaveBeenCalledTimes(4);
    for (const call of requireSettingsSection.mock.calls) {
      expect(call[0]).toBe('catalogs.automation');
    }
  });

  it('включение и выключение пишутся в журнал РАЗНЫМИ событиями', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'boss', companyId: 'co-своя' });
    await toggleAutomationRuleAction('leader', null, 'r1', true);
    await toggleAutomationRuleAction('leader', null, 'r1', false);
    const actions = recordAudit.mock.calls.map((c) => c[1].action);
    expect(actions).toEqual(['automation_rule_enabled', 'automation_rule_disabled']);
  });
});
