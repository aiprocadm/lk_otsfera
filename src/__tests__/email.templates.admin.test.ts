import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import {
  AdminUserInviteTemplate,
  adminUserInviteSubject,
  adminUserInviteText,
  type AdminUserInviteProps,
} from '@/lib/email/templates/admin-user-invite';

describe('AdminUserInviteTemplate — render smoke', () => {
  it('рендерит имя, role label и инвайт-ссылку', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminUserInviteTemplate, {
        inviteUrl: 'https://lk.otsfera.ru/reset-password?token=abc',
        name: 'Иван',
        role: 'partner',
        invitedByName: 'Anna',
      })
    );
    expect(html).toContain('Иван');
    expect(html).toContain('партнёрскому');
    expect(html).toContain('Anna');
    expect(html).toContain('abc');
    expect(html).toContain('Установить пароль');
  });

  it('рендерит без invitedByName — использует «Вас пригласили»', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminUserInviteTemplate, {
        inviteUrl: 'https://lk.otsfera.ru/reset-password?token=xyz',
        name: 'Мария',
        role: 'organization',
      })
    );
    expect(html).toContain('Вас пригласили');
    expect(html).not.toContain('Anna');
    expect(html).toContain('кабинету организации');
    expect(html).toContain('Мария');
  });

  it.each<[AdminUserInviteProps['role'], string]>([
    ['organization', 'кабинету организации'],
    ['partner', 'партнёрскому кабинету'],
    ['manager', 'кабинету менеджера'],
    ['student', 'учебному порталу'],
  ])('рендерит role label для роли %s', (role, expectedLabel) => {
    const html = renderToStaticMarkup(
      React.createElement(AdminUserInviteTemplate, {
        inviteUrl: 'https://lk.otsfera.ru/reset',
        name: 'Тест',
        role,
      })
    );
    expect(html).toContain(expectedLabel);
  });

  it('содержит срок действия ссылки', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminUserInviteTemplate, {
        inviteUrl: 'https://lk.otsfera.ru/reset',
        name: 'Тест',
        role: 'manager',
      })
    );
    expect(html).toContain('7 дней');
  });
});

describe('adminUserInviteSubject', () => {
  it('возвращает фиксированную тему', () => {
    expect(adminUserInviteSubject()).toBe('Приглашение в кабинет Промтехносферы');
  });
});

describe('adminUserInviteText', () => {
  it('содержит имя, role label и ссылку при наличии invitedByName', () => {
    const text = adminUserInviteText({
      inviteUrl: 'https://lk.otsfera.ru/reset?token=t',
      name: 'Сергей',
      role: 'manager',
      invitedByName: 'Борис',
    });
    expect(text).toContain('Сергей');
    expect(text).toContain('Борис пригласил вас');
    expect(text).toContain('кабинету менеджера');
    expect(text).toContain('https://lk.otsfera.ru/reset?token=t');
    expect(text).toContain('7 дней');
  });

  it('использует «Вас пригласили» без invitedByName', () => {
    const text = adminUserInviteText({
      inviteUrl: 'https://lk.otsfera.ru/reset',
      name: 'Олег',
      role: 'student',
    });
    expect(text).toContain('Вас пригласили');
    expect(text).toContain('учебному порталу');
  });
});
