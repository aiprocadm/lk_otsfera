// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const {
  leaderAssignManagerAction,
  leaderDeactivateAssignmentAction,
  leaderTransferOrganizationAction,
} = vi.hoisted(() => ({
  leaderAssignManagerAction: vi.fn(),
  leaderDeactivateAssignmentAction: vi.fn(),
  leaderTransferOrganizationAction: vi.fn(),
}));
vi.mock('@/server-actions/manager/team', () => ({
  leaderAssignManagerAction,
  leaderDeactivateAssignmentAction,
  leaderTransferOrganizationAction,
}));
const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { LeaderTeamBoard } from '@/components/leader/leader-team-board';
import type { TeamBoard, TeamBoardManager } from '@/lib/services/leader/teamBoard';

function manager(over: Partial<TeamBoardManager>): TeamBoardManager {
  return {
    id: 'm1',
    name: 'Анна Первая',
    email: 'anna@x',
    isLeader: false,
    isActive: true,
    lastLoginAt: null,
    orgs: [],
    ...over,
  };
}

const ROMASHKA = {
  assignmentId: 'as1',
  organizationId: 'o1',
  name: 'ООО Ромашка',
  activeOrders: 3,
  inWork: '150000.00',
  paid: '50000.00',
  overdue: 1,
};

function board(over: Partial<TeamBoard> = {}): TeamBoard {
  return {
    managers: [
      manager({ id: 'm1', orgs: [ROMASHKA] }),
      manager({ id: 'm2', name: 'Борис Второй', email: 'boris@x' }),
      manager({ id: 'l1', name: 'Лидия Руководитель', email: 'lead@x', isLeader: true }),
      manager({ id: 'off', name: 'Олег Отключён', email: 'off@x', isActive: false }),
    ],
    unassigned: { rows: [{ id: 'o9', name: 'ООО Ничья', inn: '7700000000' }], total: 1 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LeaderTeamBoard — вид (У-346, макет 2)', () => {
  it('у менеджера — его организации со статистикой, ссылкой и итогами в шапке', () => {
    render(<LeaderTeamBoard board={board()} />);
    const card = screen.getByTestId('team-manager-m1');
    expect(card).toHaveProperty('open', true);
    expect(card.textContent).toContain('Организаций: 1 · заказов в работе: 3');
    expect(card.textContent).toContain('просрочено: 1');
    expect(within(card).getByRole('link', { name: 'ООО Ромашка' }).getAttribute('href')).toBe(
      '/leader/organizations/o1'
    );
    expect(card.textContent).toMatch(/В работе: 3 на 150\s000 ₽ · оплачено 50\s000 ₽/);
  });

  it('бейджи руководителя и отключённого; без организаций — подсказка и свёрнутая карточка', () => {
    render(<LeaderTeamBoard board={board()} />);
    expect(screen.getByTestId('team-manager-l1').textContent).toContain('Руководитель');
    expect(screen.getByTestId('team-manager-off').textContent).toContain('Отключён');
    const empty = screen.getByTestId('team-manager-m2');
    expect(empty).toHaveProperty('open', false);
    expect(empty.textContent).toContain('Организаций нет');
    expect(empty.textContent).not.toContain('просрочено');
  });

  it('перевести можно только действующему рядовому менеджеру, не себе', () => {
    render(<LeaderTeamBoard board={board()} />);
    const select = screen.getByLabelText('Кому перевести «ООО Ромашка»');
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Перевести менеджеру…', 'Борис Второй']);
  });

  it('некому перевести — список и кнопка недоступны', () => {
    render(
      <LeaderTeamBoard
        board={board({
          managers: [manager({ id: 'm1', orgs: [ROMASHKA] })],
          unassigned: { rows: [{ id: 'o9', name: 'ООО Ничья', inn: null }], total: 1 },
        })}
      />
    );
    const select = screen.getByLabelText('Кому перевести «ООО Ромашка»') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain('Некому перевести');
    expect(screen.getByRole('button', { name: 'Перевести' })).toHaveProperty('disabled', true);
  });

  it('пустая команда и все организации с ответственным — пустые состояния с объяснением', () => {
    render(<LeaderTeamBoard board={{ managers: [], unassigned: { rows: [], total: 0 } }} />);
    expect(screen.getByText('Менеджеров пока нет')).toBeTruthy();
    expect(screen.getByText(/Менеджеров заводит администратор/)).toBeTruthy();
    expect(screen.getByText('У всех организаций есть ответственный')).toBeTruthy();
  });

  it('без ответственного: ИНН показан, длинный список честно усечён', () => {
    render(
      <LeaderTeamBoard
        board={board({
          unassigned: { rows: [{ id: 'o9', name: 'ООО Ничья', inn: '7700000000' }], total: 73 },
        })}
      />
    );
    expect(screen.getByText('ИНН 7700000000')).toBeTruthy();
    expect(screen.getByText(/Показаны первые 1 из 73/)).toBeTruthy();
  });
});

describe('LeaderTeamBoard — действия (У-346)', () => {
  it('перевод: действие получает организацию, прежнего и нового менеджера; тост с числом заказов', async () => {
    leaderTransferOrganizationAction.mockResolvedValue({ ok: true, ordersMoved: 2 });
    render(<LeaderTeamBoard board={board()} />);
    fireEvent.change(screen.getByLabelText('Кому перевести «ООО Ромашка»'), {
      target: { value: 'm2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const fd = leaderTransferOrganizationAction.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(fd)).toEqual({
      organizationId: 'o1',
      fromUserId: 'm1',
      toUserId: 'm2',
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Организация переведена, заказов в работе передано: 2'
    );
  });

  it('перевод без открытых заказов — короткий тост', async () => {
    leaderTransferOrganizationAction.mockResolvedValue({ ok: true, ordersMoved: 0 });
    render(<LeaderTeamBoard board={board()} />);
    fireEvent.change(screen.getByLabelText('Кому перевести «ООО Ромашка»'), {
      target: { value: 'm2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Организация переведена'));
  });

  it('отказ перевода — русская строка в строке организации', async () => {
    leaderTransferOrganizationAction.mockResolvedValue({
      ok: false,
      error: 'transfer_not_assigned',
    });
    render(<LeaderTeamBoard board={board()} />);
    fireEvent.change(screen.getByLabelText('Кому перевести «ООО Ромашка»'), {
      target: { value: 'm2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Перевести' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Организация уже не у этого менеджера — обновите страницу.'
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('снять: действие получает закрепление; успех и отказ', async () => {
    leaderDeactivateAssignmentAction.mockResolvedValueOnce({ ok: true });
    render(<LeaderTeamBoard board={board()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Менеджер снят с организации'));
    expect(
      (leaderDeactivateAssignmentAction.mock.calls[0]![0] as FormData).get('assignmentId')
    ).toBe('as1');

    leaderDeactivateAssignmentAction.mockResolvedValueOnce({ ok: false, error: 'forbidden_org' });
    fireEvent.click(screen.getByRole('button', { name: 'Снять' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Нет доступа к этой организации.');
  });

  it('назначить ответственного: выбор — только рядовые действующие; e-mail уходит в действие', async () => {
    leaderAssignManagerAction.mockResolvedValue({ ok: true, inviteUrl: null, reactivated: false });
    render(<LeaderTeamBoard board={board()} />);
    const select = screen.getByLabelText('Ответственный за «ООО Ничья»');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Выберите менеджера…',
      'Анна Первая',
      'Борис Второй',
    ]);
    expect(screen.getByRole('button', { name: 'Назначить' })).toHaveProperty('disabled', true);
    fireEvent.change(select, { target: { value: 'boris@x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Ответственный назначен'));
    expect(Object.fromEntries(leaderAssignManagerAction.mock.calls[0]![0] as FormData)).toEqual({
      mode: 'existing',
      organizationId: 'o9',
      email: 'boris@x',
    });
  });

  it('отказ назначения — русская строка', async () => {
    leaderAssignManagerAction.mockResolvedValue({ ok: false, error: 'company_mismatch' });
    render(<LeaderTeamBoard board={board()} />);
    fireEvent.change(screen.getByLabelText('Ответственный за «ООО Ничья»'), {
      target: { value: 'anna@x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Менеджер и организация принадлежат разным компаниям.'
    );
  });

  it('назначать некого — список без вариантов', () => {
    render(
      <LeaderTeamBoard board={board({ managers: [manager({ id: 'l1', isLeader: true })] })} />
    );
    const select = screen.getByLabelText('Ответственный за «ООО Ничья»') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain('Нет менеджеров');
  });
});
