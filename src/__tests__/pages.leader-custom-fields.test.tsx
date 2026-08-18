// @vitest-environment jsdom
/**
 * §11 + §4 ТЗ v0.5 — зеркало настройки полей в кабинете руководителя.
 * Отдельная страница нужна потому, что в `/admin/*` руководителя не пускают
 * (Model A, §4 CLAUDE.md), а настройку полей ТЗ ему даёт.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listDefinitions } = vi.hoisted(() => ({ listDefinitions: vi.fn() }));
vi.mock('@/lib/services/customFields/definitions', () => ({ listDefinitions }));

vi.mock('@/components/admin/custom-fields-admin', () => ({
  CustomFieldsAdmin: (props: { entity: string; basePath: string; definitions: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'custom-fields-admin' },
      JSON.stringify({
        entity: props.entity,
        basePath: props.basePath,
        definitions: props.definitions,
      })
    ),
}));

import LeaderCustomFieldsPage from '@/app/leader/settings/catalogs/custom-fields/page';

const LEADER = { sub: 'leader1', role: 'leader' as const };

describe('LeaderCustomFieldsPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    listDefinitions.mockReset();
  });

  it('гейт руководителя вызывается, ссылки ведут в его кабинет', async () => {
    requireSettingsSection.mockResolvedValue(LEADER);
    listDefinitions.mockResolvedValue({ ok: true, rows: [{ id: 'f9' }] });

    const { container } = await renderServerComponent(
      LeaderCustomFieldsPage({ searchParams: Promise.resolve({ entity: 'student' }) })
    );

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(listDefinitions).toHaveBeenCalledWith({}, LEADER, 'student');
    expect(container.textContent).toContain('"entity":"student"');
    // Ключевое: базовый путь — кабинет руководителя, а НЕ /admin/*
    expect(container.textContent).toContain('"basePath":"/leader/settings/catalogs/custom-fields"');
    expect(container.textContent).not.toContain('/admin/');
  });

  it('отказ сервиса даёт пустой список', async () => {
    requireSettingsSection.mockResolvedValue(LEADER);
    listDefinitions.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(
      LeaderCustomFieldsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('"definitions":[]');
  });
});
