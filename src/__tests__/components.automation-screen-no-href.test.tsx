// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Раздел «Автоматизация», когда реестр настроек не дал адреса раздела.
 *
 * `settingsSectionHref` возвращает `string | null` — `null`, если раздел не
 * заведён для этого кабинета. Для admin и leader он заведён, поэтому в обычных
 * тестах эта половина запасного значения не проходится никогда. Но код её
 * содержит, и она обязана вести себя разумно: выбор компании должен остаться
 * рабочим, а не увести человека на адрес `undefined?companyId=…`.
 *
 * Отдельный файл, а не случай в основном тесте: подмена реестра нужна на весь
 * модуль, и мешать её с обычными проверками экрана было бы нечестно.
 */

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('@/lib/navigation/settings', () => ({ settingsSectionHref: () => null }));

vi.mock('@/server-actions/admin/automationRules', () => ({
  toggleAutomationRuleAction: vi.fn(),
  deleteAutomationRuleAction: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/automation/automation-rule-form', () => ({
  AutomationRuleForm: () => React.createElement('div'),
}));

import { AutomationScreen } from '@/components/automation/automation-screen';

beforeEach(() => vi.clearAllMocks());

describe('AutomationScreen без адреса раздела', () => {
  const renderAdmin = () =>
    render(
      <AutomationScreen
        cabinet="admin"
        companyId={null}
        companies={[{ id: 'co-1', name: 'Альфа' }]}
        rules={[]}
        runs={[]}
      />
    );

  it('выбор компании уводит на разумный адрес, а не на «undefined»', () => {
    renderAdmin();
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: 'co-1' } });
    const target = String(push.mock.calls[0][0]);
    expect(target).toContain('companyId=co-1');
    expect(target).not.toContain('undefined');
    expect(target).not.toContain('null');
  });

  it('снятие выбора не уводит на «undefined»', () => {
    renderAdmin();
    fireEvent.change(screen.getByLabelText('Компания'), { target: { value: '' } });
    expect(String(push.mock.calls[0][0])).not.toContain('undefined');
  });
});
