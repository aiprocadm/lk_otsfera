// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminAutomationPage from '@/app/admin/settings/processes/automation/page';
import LeaderAutomationPage from '@/app/leader/settings/processes/automation/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Страницы раздела «Автоматизация» (`У-222`, этап 4).
 *
 * Проверяется не вёрстка (её держит `components.automation-screen`), а то, что
 * ломается тихо: откуда берётся компания и что происходит, когда её нет.
 *
 * У руководителя компания — ИЗ СЕССИИ. Возьми её из адреса — и руководитель
 * одной компании прочитал бы чужие правила, поменяв строку в браузере.
 * У администратора компанию выбирают, но выбор сверяется со списком: чужая
 * строка не должна показывать пустой экран «правил нет», как будто у компании
 * их действительно нет.
 */

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { companyFindMany } = vi.hoisted(() => ({ companyFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));

const { listAutomationRules, listAutomationRuns } = vi.hoisted(() => ({
  listAutomationRules: vi.fn(),
  listAutomationRuns: vi.fn(),
}));
vi.mock('@/lib/services/automation/rules', () => ({ listAutomationRules, listAutomationRuns }));

vi.mock('@/components/automation/automation-screen', () => ({
  AutomationScreen: (props: {
    cabinet: string;
    companyId: string | null;
    companies: { id: string }[];
    rules: { id: string }[];
    runs: { id: string }[];
  }) =>
    React.createElement('div', {
      'data-testid': 'automation-screen',
      'data-cabinet': props.cabinet,
      'data-company': props.companyId ?? '',
      'data-companies': props.companies.map((c) => c.id).join(','),
      'data-rules': props.rules.map((r) => r.id).join(','),
      'data-runs': props.runs.map((r) => r.id).join(','),
    }),
}));

const screen = (html: HTMLElement): HTMLElement =>
  html.querySelector('[data-testid="automation-screen"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue({ sub: 'u1', role: 'leader', companyId: 'co-1' });
  companyFindMany.mockResolvedValue([
    { id: 'co-1', name: 'Альфа' },
    { id: 'co-2', name: 'Бета' },
  ]);
  listAutomationRules.mockResolvedValue([{ id: 'r1' }]);
  listAutomationRuns.mockResolvedValue([{ id: 'run1' }]);
});

describe('страница «Автоматизация» руководителя', () => {
  it('компания берётся ИЗ СЕССИИ, правила и журнал загружаются', async () => {
    const { container } = await renderServerComponent(await LeaderAutomationPage());
    const el = screen(container);
    expect(el.getAttribute('data-cabinet')).toBe('leader');
    expect(el.getAttribute('data-company')).toBe('co-1');
    expect(el.getAttribute('data-rules')).toBe('r1');
    expect(el.getAttribute('data-runs')).toBe('run1');
    expect(listAutomationRules).toHaveBeenCalledWith(expect.anything(), 'co-1');
    // Выбора компании у руководителя нет — список пуст намеренно.
    expect(el.getAttribute('data-companies')).toBe('');
  });

  it('сотрудник БЕЗ компании — в базу не ходим вовсе', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'u1', role: 'leader', companyId: null });
    const { container } = await renderServerComponent(await LeaderAutomationPage());
    expect(screen(container).getAttribute('data-company')).toBe('');
    expect(listAutomationRules).not.toHaveBeenCalled();
    expect(listAutomationRuns).not.toHaveBeenCalled();
  });

  it('гард раздела зовётся с кодом права и кабинетом', async () => {
    await renderServerComponent(await LeaderAutomationPage());
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.automation', 'leader');
  });
});

describe('страница «Автоматизация» администратора', () => {
  const render = async (sp: Record<string, string | string[] | undefined>) =>
    renderServerComponent(await AdminAutomationPage({ searchParams: Promise.resolve(sp) }));

  it('выбранная компания из адреса загружает её правила', async () => {
    const { container } = await render({ companyId: 'co-2' });
    const el = screen(container);
    expect(el.getAttribute('data-cabinet')).toBe('admin');
    expect(el.getAttribute('data-company')).toBe('co-2');
    expect(el.getAttribute('data-companies')).toBe('co-1,co-2');
    expect(listAutomationRules).toHaveBeenCalledWith(expect.anything(), 'co-2');
  });

  it('ЧУЖАЯ строка в адресе не выдаётся за компанию', async () => {
    const { container } = await render({ companyId: 'co-выдуманная' });
    expect(screen(container).getAttribute('data-company')).toBe('');
    expect(listAutomationRules).not.toHaveBeenCalled();
  });

  it('компания не выбрана и список-массив в адресе — оба случая пустые', async () => {
    const без = await render({});
    expect(screen(без.container).getAttribute('data-company')).toBe('');

    const массив = await render({ companyId: ['co-1', 'co-2'] });
    expect(screen(массив.container).getAttribute('data-company')).toBe('');
  });

  it('гард раздела зовётся с кабинетом admin', async () => {
    await render({});
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.automation', 'admin');
  });
});
