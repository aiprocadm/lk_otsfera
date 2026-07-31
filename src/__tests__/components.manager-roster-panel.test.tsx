// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { leaderDeactivateAssignmentAction } = vi.hoisted(() => ({
  leaderDeactivateAssignmentAction: vi.fn(),
}));
vi.mock('@/server-actions/manager/team', () => ({ leaderDeactivateAssignmentAction }));

import { ManagerRosterPanel } from '@/components/manager/manager-roster-panel';
import type { CompanyManagerRow } from '@/lib/services/manager/team';

function makeManager(overrides: Partial<CompanyManagerRow>): CompanyManagerRow {
  return {
    id: 'm1',
    name: 'Иван Иванов',
    email: 'ivan@example.com',
    managerRole: null,
    lastLoginAt: null,
    assignments: [
      { id: 'as1', organizationId: 'o1', organizationName: 'ООО Ромашка', isActive: true },
    ],
    ...overrides,
  } as CompanyManagerRow;
}

describe('ManagerRosterPanel (SSR structure)', () => {
  it('empty roster: renders the empty message', () => {
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster: [] }));
    expect(html).toContain('Менеджеров пока нет');
  });

  it('non-empty roster: renders manager name, email, org assignment names', () => {
    const roster = [makeManager({})];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('ivan@example.com');
    expect(html).toContain('ООО Ромашка');
  });

  it('leader manager: renders the "Руководитель" badge', () => {
    const roster = [makeManager({ managerRole: 'leader' })];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('Руководитель');
  });

  it('non-leader manager: no badge rendered', () => {
    const roster = [makeManager({ managerRole: null })];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).not.toContain('Руководитель');
  });

  it('no active assignments: renders — placeholder for org list', () => {
    const roster = [
      makeManager({
        assignments: [
          { id: 'as1', organizationId: 'o1', organizationName: 'ООО Ромашка', isActive: false },
        ],
      }),
    ];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('—');
    expect(html).not.toContain('Снять с');
  });

  // ФТ-11.3 (этап 9): панель свёрстана списком — «колонка» стала строкой карточки.
  // Дата фикстуры намеренно в прошлом — иначе форматтер отдал бы «сегодня, HH:mm»
  // в тот единственный день, когда прогон совпал бы с датой фикстуры.
  it('строка «Последний вход» с отформатированной датой', () => {
    const roster = [makeManager({ lastLoginAt: new Date('2025-11-05T10:00:00Z') })];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('Последний вход: <!-- -->05.11.2025');
  });

  it('менеджер ни разу не входил (lastLoginAt=null): в строке прочерк', () => {
    const roster = [makeManager({ lastLoginAt: null })];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('Последний вход: <!-- -->—');
  });

  it('multiple active assignments: org names joined with comma', () => {
    const roster = [
      makeManager({
        assignments: [
          { id: 'as1', organizationId: 'o1', organizationName: 'Орг А', isActive: true },
          { id: 'as2', organizationId: 'o2', organizationName: 'Орг Б', isActive: true },
        ],
      }),
    ];
    const html = renderToString(React.createElement(ManagerRosterPanel, { roster }));
    expect(html).toContain('Орг А, Орг Б');
  });
});

describe('ManagerRosterPanel (interactive, jsdom)', () => {
  beforeEach(() => {
    leaderDeactivateAssignmentAction.mockReset();
    leaderDeactivateAssignmentAction.mockResolvedValue({ ok: true });
  });

  it('clicking "Снять с {org}" calls leaderDeactivateAssignmentAction with the assignment id', async () => {
    const roster = [makeManager({})];
    render(React.createElement(ManagerRosterPanel, { roster }));

    fireEvent.click(screen.getByText('Снять с ООО Ромашка'));

    await waitFor(() => expect(leaderDeactivateAssignmentAction).toHaveBeenCalled());
    const fd = leaderDeactivateAssignmentAction.mock.calls[0][0] as FormData;
    expect(fd.get('assignmentId')).toBe('as1');
  });
});
