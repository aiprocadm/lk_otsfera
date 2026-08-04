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
        basePath: '/admin/settings/security/audit',
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

  it('в списке действий — русские названия, значения остаются машинными', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        basePath: '/admin/settings/security/audit',
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: {},
      })
    );
    // Фильтр по-прежнему отправляет машинный код...
    expect(html).toContain('value="user_created"');
    expect(html).toContain('value="partner_created"');
    // ...а человек видит русское название и ни одного английского кода.
    expect(html).toContain('Создание пользователя');
    expect(html).toContain('Изменение пользователя');
    expect(html).toContain('Создание партнёра');
    expect(html).not.toContain('>user_created<');
  });

  it('в списке сущностей — русские названия, актёры как есть', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        basePath: '/admin/settings/security/audit',
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: {},
      })
    );
    expect(html).toContain('value="user"');
    expect(html).toContain('>Пользователь<');
    expect(html).toContain('>Партнёр<');
    expect(html).toContain('>Организация<');
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('ivan@example.com');
  });

  it('renders reset link when current.entity is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        basePath: '/admin/settings/security/audit',
        entities: ENTITIES,
        actions: ACTIONS,
        actors: ACTORS,
        current: { entity: 'user' },
      })
    );
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/admin/settings/security/audit"');
  });

  it('renders reset link when current.action is set', () => {
    const html = renderToString(
      React.createElement(AuditLogFilters, {
        basePath: '/admin/settings/security/audit',
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
        basePath: '/admin/settings/security/audit',
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
        basePath: '/admin/settings/security/audit',
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
        basePath: '/admin/settings/security/audit',
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
        basePath: '/admin/settings/security/audit',
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
      React.createElement(AuditLogFilters, {
        basePath: '/admin/settings/security/audit',
        entities: [],
        actions: [],
        actors: [],
        current: {},
      })
    );
    expect(html).toContain('Все сущности');
  });
});
