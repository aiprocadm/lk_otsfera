import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerOrgCard } from '@/components/manager/manager-org-card';
import type { ManagerOrgDetail } from '@/lib/services/manager/organizations';

describe('ManagerOrgCard', () => {
  it('renders name, partner, and count tiles', () => {
    const org = {
      name: 'ООО Ромашка',
      partner: { name: 'Партнёр Иванов' },
      _count: { orders: 3, students: 10, users: 2 }
    } as ManagerOrgDetail;
    const html = renderToString(React.createElement(ManagerOrgCard, { org }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Партнёр Иванов');
    expect(html).toContain('3');
    expect(html).toContain('10');
    expect(html).toContain('2');
  });

  it('renders without partner block when partner is null', () => {
    const org = {
      name: 'ООО Ромашка',
      partner: null,
      _count: { orders: 0, students: 0, users: 0 }
    } as ManagerOrgDetail;
    const html = renderToString(React.createElement(ManagerOrgCard, { org }));
    expect(html).not.toContain('Партнёр:');
  });
});
