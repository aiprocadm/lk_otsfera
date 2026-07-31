import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { AuditLogFilters } from '@/components/admin/audit-log-filters';
import type { AuditEntity } from '@/lib/auth/audit';

const ENTITIES: AuditEntity[] = ['user', 'partner', 'organization'];
const ACTIONS = ['user_created', 'user_updated', 'partner_created'];
const ACTORS = [
  { id: 'a1', name: 'Иван Иванов', email: 'ivan@example.com' },
  { id: 'a2', name: 'Пётр Петров', email: 'petr@example.com' },
];

describe('AuditLogFilters', () => {
  it('renders with no active filters: no reset link, all-options defaults', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: {},
      })
    );
    expect(html).not.toContain('Сбросить');
    expect(html).toContain('Все сущности');
    expect(html).toContain('Все действия');
    expect(html).toContain('Все пользователи');
  });

  it('groups actions by prefix into optgroups', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: {},
      })
    );
    expect(html).toContain('<optgroup label="user"');
    expect(html).toContain('<optgroup label="partner"');
    expect(html).toContain('user_created');
    expect(html).toContain('user_updated');
    expect(html).toContain('partner_created');
  });

  it('lists entity options and actor options', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: {},
      })
    );
    expect(html).toContain('>user<');
    expect(html).toContain('>partner<');
    expect(html).toContain('>organization<');
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('ivan@example.com');
  });

  it('renders reset link when current.entity is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { entity: 'user' },
      })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/admin/audit"');
  });

  it('renders reset link when current.action is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { action: 'user_created' },
      })
    );
    expect(html).toContain('Сбросить');
  });

  it('renders reset link when current.actorUserId is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { actorUserId: 'a1' },
      })
    );
    expect(html).toContain('Сбросить');
  });

  it('renders reset link when current.from is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { from: '2026-01-01' },
      })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('value="2026-01-01"');
  });

  it('renders reset link when current.to is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { to: '2026-02-01' },
      })
    );
    expect(html).toContain('Сбросить');
  });

  it('renders reset link when current.q is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { q: 'foo' },
      })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('value="foo"');
  });

  it('handles empty entities/actions/actors arrays without throwing', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, { entities: [], actions: [], actors: [], current: {} })
    );
    expect(html).toContain('Все сущности');
  });
});
