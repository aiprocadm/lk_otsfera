// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import { UsersFilters } from '@/components/admin/users-filters';
import { UserInviteForm } from '@/components/admin/user-invite-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { createUserAction } = vi.hoisted(() => ({ createUserAction: vi.fn() }));
vi.mock('@/server-actions/admin/users', () => ({ createUserAction }));

const COMPANIES = [
  { id: 'c1', name: 'Промтехносфера' },
  { id: 'c2', name: 'Вторая' },
];

beforeEach(() => {
  createUserAction.mockReset();
});

/**
 * `У-119`: роль «Руководитель» существует с 18.08.2026, но в кабинете
 * администратора её не было ни в приглашении, ни в фильтрах — руководителя
 * заводили менеджером и «повышали», а в списке он прятался среди менеджеров.
 */
describe('роль «Руководитель» в кабинете администратора (У-119)', () => {
  it('фильтр списка знает руководителей наравне с менеджерами', () => {
    const { container } = render(<UsersFilters />);
    const options = [...container.querySelectorAll('select[name="role"] option')].map((o) =>
      o.getAttribute('value')
    );
    expect(options).toContain('manager');
    expect(options).toContain('leader');
  });

  it('приглашение позволяет завести руководителя сразу', () => {
    const { container } = render(<UserInviteForm partners={[]} companies={COMPANIES} />);
    const roles = [...container.querySelectorAll('select[name="role"] option')].map((o) =>
      o.getAttribute('value')
    );
    expect(roles).toContain('leader');
    // Прежний путь «пригласить менеджером → повысить» никуда не делся.
    expect(roles).toContain('manager');
  });
});

/**
 * Дыра, найденная при выполнении `У-119`: приглашённый сотрудник ЦО заводился
 * **без компании**. `session.companyId` оставался пустым, скоупы отвечали
 * deny-all — человек входил в кабинет, где нет ни заказов, ни клиентов, и
 * причину увидеть было негде.
 */
describe('сотруднику ЦО при приглашении выбирают компанию', () => {
  const roleSelect = (c: HTMLElement) =>
    c.querySelector('select[name="role"]') as HTMLSelectElement;

  it('для менеджера и руководителя поле компании появляется и обязательно', () => {
    for (const role of ['manager', 'leader']) {
      const { container } = render(<UserInviteForm partners={[]} companies={COMPANIES} />);
      fireEvent.change(roleSelect(container), { target: { value: role } });

      const select = container.querySelector('select[name="companyId"]');
      expect(select, role).not.toBeNull();
      expect(select?.hasAttribute('required'), role).toBe(true);
      expect(
        [...within(select as HTMLElement).getAllByRole('option')].map((o) => o.textContent)
      ).toContain('Промтехносфера');
    }
  });

  it('для клиентских ролей поля компании нет — им она не нужна', () => {
    for (const role of ['organization', 'partner', 'student']) {
      const { container } = render(<UserInviteForm partners={[]} companies={COMPANIES} />);
      fireEvent.change(roleSelect(container), { target: { value: role } });
      expect(container.querySelector('select[name="companyId"]'), role).toBeNull();
    }
  });
});

/** Фильтр по компании — дефект `Д-34`: список был общим на все компании. */
describe('фильтр списка по компании (Д-34)', () => {
  it('появляется, когда компании переданы, и помнит выбранную', () => {
    const { container } = render(<UsersFilters companies={COMPANIES} companyId="c2" />);
    const select = container.querySelector('select[name="companyId"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('c2');
    // Выбранный фильтр показывает «Сбросить» — иначе из него не выбраться.
    expect(container.textContent).toContain('Сбросить');
  });

  it('без списка компаний селекта нет, а не пустой', () => {
    const { container } = render(<UsersFilters />);
    expect(container.querySelector('select[name="companyId"]')).toBeNull();
  });
});
