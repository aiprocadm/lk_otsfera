// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { CallsOrgFilter } from '@/components/manager/calls-org-filter';

const ORGS = [
  { id: 'org-1', name: 'Альфа Пром' },
  { id: 'org-2', name: 'Бета Сталь' }
];

function getSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select');
  if (!select) throw new Error('select не найден');
  return select;
}

describe('CallsOrgFilter', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('рендерит «Все организации» + имена организаций; без orgId выбрана пустая опция', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} />);
    const select = getSelect(container);
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Все организации', 'Альфа Пром', 'Бета Сталь']);
    expect(select.value).toBe('');
    expect(push).not.toHaveBeenCalled();
  });

  it('orgId из searchParams выбирает соответствующую опцию', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} orgId='org-2' />);
    expect(getSelect(container).value).toBe('org-2');
  });

  it('выбор организации пушит ?orgId=<id>&direction=<текущий> без page (сброс пагинации)', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} direction='inbound' />);
    fireEvent.change(getSelect(container), { target: { value: 'org-1' } });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/manager/calls?orgId=org-1&direction=inbound');
  });

  it('выбор организации без direction пушит только orgId', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} />);
    fireEvent.change(getSelect(container), { target: { value: 'org-2' } });
    expect(push).toHaveBeenCalledWith('/manager/calls?orgId=org-2');
  });

  it('«Все организации» пушит без orgId, direction сохраняется', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} orgId='org-1' direction='outbound' />);
    fireEvent.change(getSelect(container), { target: { value: '' } });
    expect(push).toHaveBeenCalledWith('/manager/calls?direction=outbound');
  });

  it('«Все организации» без direction пушит чистый /manager/calls', () => {
    const { container } = render(<CallsOrgFilter orgs={ORGS} orgId='org-1' />);
    fireEvent.change(getSelect(container), { target: { value: '' } });
    expect(push).toHaveBeenCalledWith('/manager/calls');
  });
});
