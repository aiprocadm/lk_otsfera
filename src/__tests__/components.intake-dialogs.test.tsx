// @vitest-environment jsdom
/**
 * Этап 7 — диалоги Intake: «Создать лид из источника» (ФТ-1.6), быстрая задача
 * (ФТ-7.5), фильтры лидера (ФТ-8.3), SourceIntakeActions, NavBadge (ФТ-8.4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh, push, replace } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
  usePathname: () => '/leader/intake',
  useSearchParams: () => new URLSearchParams('skip=50')
}));

const { createLeadFromInboundAction, createLeadFromCallAction } = vi.hoisted(() => ({
  createLeadFromInboundAction: vi.fn(),
  createLeadFromCallAction: vi.fn()
}));
vi.mock('@/server-actions/intake', () => ({ createLeadFromInboundAction, createLeadFromCallAction }));

const { createTaskAction } = vi.hoisted(() => ({ createTaskAction: vi.fn() }));
vi.mock('@/server-actions/tasks', () => ({ createTaskAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { CreateLeadFromSourceDialog } from '@/components/intake/create-lead-from-source-dialog';
import { QuickTaskDialog } from '@/components/intake/quick-task-dialog';
import { IntakeFilters } from '@/components/intake/intake-filters';
import { SourceIntakeActions } from '@/components/intake/source-intake-actions';

const PREFILL = { companyName: 'ООО Тест', contactName: 'Иван', contactPhone: '+7999', contactEmail: 'a@b.ru', subject: 'Тема' };

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('CreateLeadFromSourceDialog', () => {
  it('префилл в полях; сабмит inbound-экшеном с sourceId; успех → переход на лид', async () => {
    createLeadFromInboundAction.mockResolvedValue({ ok: true, leadId: 'lead-5' });
    render(<CreateLeadFromSourceDialog kind="inbound" sourceId="i1" prefill={PREFILL} onClose={vi.fn()} />);

    expect((screen.getByLabelText('Компания клиента') as HTMLInputElement).value).toBe('ООО Тест');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.ru');

    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(createLeadFromInboundAction).toHaveBeenCalled());
    const fd = createLeadFromInboundAction.mock.calls[0]![0] as FormData;
    expect(fd.get('sourceId')).toBe('i1');
    expect(fd.get('companyName')).toBe('ООО Тест');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/manager/leads/lead-5'));
    expect(toastSuccess).toHaveBeenCalledWith('Лид создан.');
  });

  it('kind=call использует call-экшен', async () => {
    createLeadFromCallAction.mockResolvedValue({ ok: true, leadId: 'lead-6' });
    render(<CreateLeadFromSourceDialog kind="call" sourceId="c1" prefill={PREFILL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(createLeadFromCallAction).toHaveBeenCalled());
    expect(createLeadFromInboundAction).not.toHaveBeenCalled();
  });

  it('validation с messages → список role=alert, без toast/перехода', async () => {
    createLeadFromInboundAction.mockResolvedValue({ ok: false, error: 'validation', messages: ['Укажите компанию'] });
    render(<CreateLeadFromSourceDialog kind="inbound" sourceId="i1" prefill={PREFILL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    // В Dialog есть собственный always-mounted alert-регион — ищем по всем.
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent).join(' ');
      expect(alerts).toContain('Укажите компанию');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('already_converted → понятный toast', async () => {
    createLeadFromInboundAction.mockResolvedValue({ ok: false, error: 'already_converted' });
    render(<CreateLeadFromSourceDialog kind="inbound" sourceId="i1" prefill={PREFILL} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Из этого источника лид уже создан.'));
  });

  it('«Отмена» зовёт onClose', () => {
    const onClose = vi.fn();
    render(<CreateLeadFromSourceDialog kind="inbound" sourceId="i1" prefill={PREFILL} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('QuickTaskDialog', () => {
  it('сабмит: префилл названия, орг-привязка, «на себя»; успех → toast + onClose + refresh', async () => {
    createTaskAction.mockResolvedValue({ ok: true, id: 't1' });
    const onClose = vi.fn();
    render(<QuickTaskDialog titlePrefill="Перезвонить: +7999" organizationId="org-1" currentUserId="m1" onClose={onClose} />);

    expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('Перезвонить: +7999');
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(createTaskAction).toHaveBeenCalled());
    const fd = createTaskAction.mock.calls[0]![0] as FormData;
    expect(fd.get('linkedOrganizationId')).toBe('org-1');
    expect(fd.getAll('assigneeIds')).toEqual(['m1']);
    expect(fd.get('assignSelf')).toBeNull();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('без организации и со снятым «на себя»; ошибка → toast, диалог жив', async () => {
    createTaskAction.mockResolvedValue({ ok: false, error: 'validation' });
    const onClose = vi.fn();
    render(<QuickTaskDialog titlePrefill="Задача" organizationId={null} currentUserId="m1" onClose={onClose} />);
    fireEvent.click(screen.getByText('на себя'));
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const fd = createTaskAction.mock.calls[0]![0] as FormData;
    expect(fd.get('linkedOrganizationId')).toBeNull();
    expect(fd.getAll('assigneeIds')).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('IntakeFilters', () => {
  const managers = [{ id: 'm2', name: 'Мария' }];

  it('выбор менеджера пишет assignee и сбрасывает skip', () => {
    render(<IntakeFilters managers={managers} assigneeId={null} onlyUnassigned={false} />);
    fireEvent.change(screen.getByLabelText('Ответственный'), { target: { value: 'm2' } });
    expect(replace).toHaveBeenCalledWith('/leader/intake?assignee=m2');
  });

  it('«Без ответственного» включается, глушит фильтр менеджера и убирается', () => {
    const { rerender } = render(<IntakeFilters managers={managers} assigneeId="m2" onlyUnassigned={false} />);
    fireEvent.click(screen.getByLabelText('Без ответственного'));
    expect(replace).toHaveBeenCalledWith('/leader/intake?unassigned=1');

    replace.mockReset();
    rerender(<IntakeFilters managers={managers} assigneeId={null} onlyUnassigned={true} />);
    expect((screen.getByLabelText('Ответственный') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Без ответственного'));
    expect(replace).toHaveBeenCalledWith('/leader/intake');
  });
});

describe('SourceIntakeActions', () => {
  it('открывает диалог лида по кнопке «Создать лид»', () => {
    render(
      <SourceIntakeActions kind="call" sourceId="c1" leadPrefill={PREFILL} taskTitle="Перезвонить" organizationId={null} currentUserId="m1" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать лид' }));
    expect(screen.getByLabelText('Компания клиента')).toBeTruthy();
  });

  it('showLead=false прячет «Создать лид»; «Задача» открывает quick-диалог', () => {
    render(
      <SourceIntakeActions kind="call" sourceId="c1" leadPrefill={PREFILL} taskTitle="Перезвонить" organizationId={null} currentUserId="m1" showLead={false} />
    );
    expect(screen.queryByRole('button', { name: 'Создать лид' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Задача' }));
    expect(screen.getByLabelText('Название')).toBeTruthy();
  });
});
