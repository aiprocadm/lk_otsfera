// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

const { useClientResource } = vi.hoisted(() => ({ useClientResource: vi.fn() }));
vi.mock('@/hooks/useClientResource', () => ({ useClientResource }));

import { NavBadge } from '@/components/navigation/nav-badge';

// Этап 7 (ФТ-8.4) — пилл-счётчик пункта меню поверх /api/staff/badges.
describe('NavBadge', () => {
  beforeEach(() => useClientResource.mockReset());

  it('поллит агрегирующий эндпоинт и выбирает свой ключ через select', () => {
    useClientResource.mockReturnValue({ data: 5 });
    render(<NavBadge badgeKey="intake" />);
    expect(screen.getByText('5')).toBeTruthy();
    expect(useClientResource).toHaveBeenCalledWith('/api/staff/badges', expect.objectContaining({ intervalMs: 30_000 }));
    const select = useClientResource.mock.calls[0]![1].select as (raw: unknown) => number;
    expect(select({ intake: 7, tasksOverdue: 2 })).toBe(7);
    expect(select({})).toBe(0);
  });

  it('ничего не рендерит при 0/null', () => {
    useClientResource.mockReturnValue({ data: 0 });
    const { container } = render(<NavBadge badgeKey="tasksOverdue" />);
    expect(container.innerHTML).toBe('');
    useClientResource.mockReturnValue({ data: null });
    const { container: c2 } = render(<NavBadge badgeKey="tasksOverdue" />);
    expect(c2.innerHTML).toBe('');
  });

  it('aria-label различает ключи', () => {
    useClientResource.mockReturnValue({ data: 2 });
    render(<NavBadge badgeKey="tasksOverdue" />);
    expect(screen.getByLabelText('Просроченные задачи')).toBeTruthy();
  });
});
