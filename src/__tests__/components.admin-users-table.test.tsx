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

vi.mock('@/server-actions/admin/users', () => ({
  deactivateUserFormAction: vi.fn(),
  reactivateUserFormAction: vi.fn(),
}));

// InviteResendButtons — 'use client' с server-action импортом; для SSR-string
// тестов достаточно заглушить экшен, компонент рендерим настоящий.
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction: vi.fn() }));

import { UsersTable } from '@/components/admin/users-table';

function makeRow(
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'manager' | 'partner' | 'organization' | 'student';
    isActive: boolean;
    createdAt: Date;
    attachmentLabel: string;
    invitePending: boolean;
    lastLoginAt: Date | null;
  }> = {}
) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Тест Пользователь',
    role: 'partner' as const,
    isActive: true,
    createdAt: new Date('2025-03-15'),
    attachmentLabel: 'ООО Партнёр',
    invitePending: false,
    lastLoginAt: null as Date | null,
    ...overrides,
  };
}

describe('UsersTable', () => {
  it('рендерит «Пользователей не найдено» на пустой list', () => {
    const html = renderToString(React.createElement(UsersTable, { rows: [], currentUserId: 'me' }));
    expect(html).toContain('не найдено');
  });

  it('скрывает кнопку Деактивировать для самого себя', () => {
    const rows = [makeRow({ id: 'me', isActive: true })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'me' }));
    expect(html).not.toContain('Деактивировать');
  });

  it('рендерит строку пользователя с корректными колонками', () => {
    const rows = [
      makeRow({
        id: 'u1',
        email: 'ivan@test.com',
        name: 'Иван Иванов',
        role: 'manager',
        isActive: true,
        createdAt: new Date('2025-01-20'),
        attachmentLabel: 'Организация А',
      }),
    ];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));

    expect(html).toContain('ivan@test.com');
    expect(html).toContain('Иван Иванов');
    expect(html).toContain('Менеджер');
    expect(html).toContain('Организация А');
    expect(html).toContain('text-green-600');
    expect(html).toContain('href="/admin/users/u1"');
    expect(html).toContain('Редактировать');
    expect(html).toContain('20.01.2025');
  });

  it('показывает «Восстановить» для неактивного пользователя вместо «Деактивировать»', () => {
    const rows = [makeRow({ id: 'u2', isActive: false })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('Восстановить');
    expect(html).not.toContain('Деактивировать');
    expect(html).toContain('text-gray-300');
  });

  it('показывает «Деактивировать» для активного чужого пользователя', () => {
    const rows = [makeRow({ id: 'u3', isActive: true })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('Деактивировать');
    expect(html).not.toContain('Восстановить');
  });

  it('invitePending=true у активного пользователя: бейдж «Ожидает пароль» и кнопки переотправки', () => {
    const rows = [makeRow({ id: 'u-pending', invitePending: true })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('Ожидает пароль');
    expect(html).toContain('Отправить повторно');
    expect(html).toContain('Скопировать ссылку');
  });

  it('деактивированный пользователь с invitePending=true: ни бейджа, ни кнопок', () => {
    const rows = [makeRow({ id: 'u-off', invitePending: true, isActive: false })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).not.toContain('Ожидает пароль');
    expect(html).not.toContain('Отправить повторно');
  });

  it('invitePending=false: бейджа и кнопок переотправки нет', () => {
    const rows = [makeRow({ id: 'u-ok' })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).not.toContain('Ожидает пароль');
    expect(html).not.toContain('Отправить повторно');
  });

  it('falls back to the raw role string for an unknown role not in ROLE_LABELS', () => {
    const rows = [makeRow({ id: 'u-unknown', role: 'superadmin' as never })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('superadmin');
  });

  // ФТ-11.3 (этап 9): колонка «Последний вход».
  // Дата фикстуры намеренно в прошлом — иначе форматтер отдал бы «сегодня, HH:mm»
  // в тот единственный день, когда прогон совпал бы с датой фикстуры.
  it('колонка «Последний вход»: заголовок и отформатированная дата', () => {
    const rows = [makeRow({ id: 'u-login', lastLoginAt: new Date('2025-11-05T10:00:00Z') })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('Последний вход');
    expect(html).toContain('05.11.2025');
  });

  it('пользователь ни разу не входил (lastLoginAt=null): в колонке прочерк', () => {
    const rows = [makeRow({ id: 'u-never', lastLoginAt: null })];
    const html = renderToString(React.createElement(UsersTable, { rows, currentUserId: 'other' }));
    expect(html).toContain('Последний вход');
    expect(html).toContain('>—<');
  });

  it('применяет ROLE_LABELS для всех ролей', () => {
    const roles: Array<[string, string]> = [
      ['admin', 'Админ'],
      ['manager', 'Менеджер'],
      ['partner', 'Партнёр'],
      ['organization', 'Организация'],
      ['student', 'Студент'],
    ];
    for (const [role, label] of roles) {
      const rows = [makeRow({ id: `u-${role}`, role: role as never })];
      const html = renderToString(
        React.createElement(UsersTable, { rows, currentUserId: 'other' })
      );
      expect(html).toContain(label);
    }
  });
});
