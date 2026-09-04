// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * `У-173` — вкладка «Выгрузка документов» в «Обмене с 1С»: зеркало admin/leader
 * (§15). Страница — тонкий слой: гард раздела → фильтр из адреса → сервис →
 * презентационный экран. Экран мокается: его собственное поведение — в
 * components.one-c-documents-export-screen.test.tsx.
 */
const { requireSettingsSection, listExportCandidates } = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  listExportCandidates: vi.fn(),
}));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('@/lib/services/oneCSync/exportPackage', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/oneCSync/exportPackage')>();
  return { ...actual, listExportCandidates };
});
vi.mock('@/components/settings/one-c-documents-export-screen', () => ({
  OneCDocumentsExportScreen: (props: {
    cabinet: string;
    items: unknown[];
    ready: number;
    truncated: boolean;
    sp: Record<string, string | undefined>;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'export-screen', 'data-cabinet': props.cabinet },
      `${props.items.length}/${props.ready}/${props.truncated}/${props.sp.type ?? ''}`
    ),
}));

import AdminOneCDocumentsPage from '@/app/admin/settings/integrations/1c/documents/page';
import LeaderOneCDocumentsPage from '@/app/leader/settings/integrations/1c/documents/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const, companyId: 'c1' };

beforeEach(() => {
  requireSettingsSection
    .mockReset()
    .mockImplementation((_id: string, cabinet: string) =>
      Promise.resolve(cabinet === 'admin' ? ADMIN : LEADER)
    );
  listExportCandidates.mockReset().mockResolvedValue({
    ok: true,
    items: [{ id: 'd1' }, { id: 'd2' }],
    ready: 1,
    truncated: false,
  });
});

describe.each([
  ['admin', AdminOneCDocumentsPage, ADMIN],
  ['leader', LeaderOneCDocumentsPage, LEADER],
] as const)('«Выгрузка документов» — кабинет %s (У-173)', (cabinet, Page, session) => {
  it('гард раздела, фильтр из адреса — в сервис, результат — на экран своего кабинета', async () => {
    const { container } = await renderServerComponent(
      Page({ searchParams: Promise.resolve({ type: 'act', from: '2026-09-01', to: 'кривая' }) })
    );
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.oneC', cabinet);
    expect(listExportCandidates).toHaveBeenCalledWith({ tag: 'prisma' }, session, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: undefined,
      type: 'act',
      oneCPushStatus: undefined,
    });
    const screen = container.querySelector('[data-testid="export-screen"]');
    expect(screen?.getAttribute('data-cabinet')).toBe(cabinet);
    expect(screen?.textContent).toBe('2/1/false/act');
  });

  it('отказ сервиса — понятная ошибка вместо экрана', async () => {
    listExportCandidates.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(Page({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Недостаточно прав');
    expect(container.querySelector('[data-testid="export-screen"]')).toBeNull();
  });
});
