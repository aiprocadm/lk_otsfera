// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * `У-331` (`Д-65`, ТЗ 28.10.2026): «режим отскакивает обратно на
 * Администратора». На стенде роль на сервере менялась (три успешные смены в
 * журнале), но страница не обновлялась и подтверждения не было, а отказ
 * сервера уходил только в журнал. Форма обязана: обновить страницу после
 * успеха, сказать «Роль изменена», показать отказ по-русски.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success } }));

const { updateOrgMemberRoleAction } = vi.hoisted(() => ({ updateOrgMemberRoleAction: vi.fn() }));
vi.mock('@/server-actions/organization/team', () => ({ updateOrgMemberRoleAction }));

import { MemberRoleForm } from '@/components/organization/member-role-form';

const base = {
  organizationId: 'orgA',
  orgUserId: 'ou1',
  role: 'admin' as const,
  canGrantAdmin: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  updateOrgMemberRoleAction.mockResolvedValue({ ok: true });
});

describe('MemberRoleForm (У-331)', () => {
  it('успех: отправляет новую роль, говорит «Роль изменена» и обновляет страницу', async () => {
    render(React.createElement(MemberRoleForm, base));
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'member' } });
    fireEvent.click(screen.getByText('Применить'));

    await waitFor(() => expect(updateOrgMemberRoleAction).toHaveBeenCalledTimes(1));
    const fd = updateOrgMemberRoleAction.mock.calls[0]![0] as FormData;
    expect([fd.get('organizationId'), fd.get('orgUserId'), fd.get('newRole')]).toEqual([
      'orgA',
      'ou1',
      'member',
    ]);
    await waitFor(() => expect(success).toHaveBeenCalledWith('Роль изменена'));
    expect(refresh).toHaveBeenCalled();
  });

  it('отказ сервера виден человеку, а не только в журнале', async () => {
    updateOrgMemberRoleAction.mockResolvedValue({ ok: false, error: 'last_admin_protected' });
    render(React.createElement(MemberRoleForm, base));
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'member' } });
    fireEvent.click(screen.getByText('Применить'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('последнего администратора')
    );
    expect(success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('«Применить» неактивна, пока роль не изменена', () => {
    render(React.createElement(MemberRoleForm, base));
    expect((screen.getByText('Применить') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'leader' } });
    expect((screen.getByText('Применить') as HTMLButtonElement).disabled).toBe(false);
  });

  it('руководитель организации не может назначить администратора', () => {
    render(React.createElement(MemberRoleForm, { ...base, role: 'member', canGrantAdmin: false }));
    const options = Array.from(screen.getByLabelText('Роль').querySelectorAll('option')).map(
      (o) => o.value
    );
    expect(options).toEqual(['member', 'leader']);
  });
});
