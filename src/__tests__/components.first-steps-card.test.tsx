import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstStepsCard } from '@/components/dashboard/first-steps-card';
import type { FirstStepsView } from '@/lib/dashboard/firstSteps';

/** Блок «Первые шаги» (`У-239`): презентационный, один на оба кабинета. */

const VIEW: FirstStepsView = {
  items: [
    {
      key: 'requisites',
      title: 'Заполнить реквизиты',
      hint: 'ИНН и адрес',
      href: '/organization/company?tab=settings',
      done: true,
    },
    {
      key: 'bot',
      title: 'Привязать бота',
      hint: 'Уведомления',
      href: '/organization/settings?tab=profile',
      done: false,
    },
  ],
  doneCount: 1,
  dismissed: false,
  visible: true,
};

const noop = async () => {};

function html(view: FirstStepsView) {
  return renderToStaticMarkup(
    React.createElement(FirstStepsCard, {
      view,
      dismissAction: noop,
      scopeField: { name: 'organizationId', value: 'org1' },
    })
  );
}

describe('FirstStepsCard', () => {
  it('заголовок, подзаголовок, прогресс, пункты: выполненный без ссылки, невыполненный со ссылкой', () => {
    const out = html(VIEW);
    expect(out).toContain('Первые шаги');
    expect(out).toContain('Что настроить, чтобы кабинет заработал на вас');
    expect(out).toContain('Готово 1 из 2');
    expect(out).toContain('data-testid="first-step-requisites" data-done="1"');
    expect(out).toContain('data-testid="first-step-bot" data-done="0"');
    expect(out).toContain('href="/organization/settings?tab=profile"');
    expect(out).not.toContain('href="/organization/company?tab=settings"');
    expect(out).toContain('line-through');
  });

  it('«Закрыть» — форма с идентификатором членства', () => {
    const out = html(VIEW);
    expect(out).toContain('name="organizationId" value="org1"');
    expect(out).toContain('Закрыть');
  });

  it('невидимый блок не рендерится', () => {
    expect(html({ ...VIEW, visible: false })).toBe('');
  });
});
