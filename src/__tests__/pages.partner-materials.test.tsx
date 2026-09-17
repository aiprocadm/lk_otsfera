// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
const { listPartnerMaterials } = vi.hoisted(() => ({ listPartnerMaterials: vi.fn() }));
vi.mock('@/lib/services/partnerMaterials/partner', () => ({ listPartnerMaterials }));
vi.mock('@/components/partner/partner-material-download-button', () => ({
  PartnerMaterialDownloadButton: () => React.createElement('button', null, 'Скачать'),
}));

import PartnerMaterialsPage from '@/app/partner/materials/page';

/** «Материалы» партнёра (`У-237`): гард роли, поиск из адреса, три вопроса §15. */
const SESSION = { sub: 'u1', role: 'partner' as const, partnerId: 'p1', assignedOrgIds: [] };

beforeEach(() => {
  vi.clearAllMocks();
  requirePartner.mockResolvedValue(SESSION);
  listPartnerMaterials.mockResolvedValue([]);
});

describe('PartnerMaterialsPage', () => {
  it('заголовок = пункт меню, подзаголовок, сервис со скоупом сессии; пусто — объяснение', async () => {
    const { container } = await renderServerComponent(
      PartnerMaterialsPage({ searchParams: Promise.resolve({}) })
    );
    expect(requirePartner).toHaveBeenCalled();
    expect(listPartnerMaterials).toHaveBeenCalledWith({}, SESSION, {});
    expect(container.textContent).toContain('Материалы');
    expect(container.textContent).toContain('от учебного центра');
    expect(container.textContent).toContain('Материалов пока нет');
  });

  it('поиск из адреса передаётся сервису и остаётся в поле', async () => {
    listPartnerMaterials.mockResolvedValue([
      {
        id: 'm1',
        title: 'Прайс',
        description: null,
        category: 'price_list',
        companyId: 'c1',
        companyName: 'УЦ',
        externalUrl: null,
        file: { fileName: 'p.pdf', mimeType: 'application/pdf', size: 10 },
        publishedAt: new Date(),
        updatedAt: new Date(),
        isNew: true,
      },
    ]);
    const { container } = await renderServerComponent(
      PartnerMaterialsPage({ searchParams: Promise.resolve({ q: 'прайс' }) })
    );
    expect(listPartnerMaterials).toHaveBeenCalledWith({}, SESSION, { q: 'прайс' });
    expect(container.querySelector('input[name="q"]')?.getAttribute('value')).toBe('прайс');
    expect(container.textContent).toContain('Прайс');
    expect(container.textContent).toContain('Новое');
  });
});
