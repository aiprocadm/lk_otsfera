// @vitest-environment jsdom
/**
 * Блоки карточки документа у администратора (`У-251`, `У-254`).
 *
 * Соседний тест (`pages.document-detail`) проверяет гарды и адреса ссылок и
 * нарочно держит историю «не найдена». Здесь — вторая половина: что бывает,
 * когда история **есть**, и когда документу можно загрузить новую версию.
 *
 * Правило зеркала (§0.2): у администратора те же блоки, что у менеджера и
 * руководителя. Блок «через одного» — это дефект приёмки, а не экономия.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDocumentDetail: vi.fn(),
  getDocumentHistory: vi.fn(),
  getFieldsForEntity: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND');
  }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/services/documents/detail', () => ({ getDocumentDetail: mocks.getDocumentDetail }));
vi.mock('@/lib/services/documents/history', () => ({
  getDocumentHistory: mocks.getDocumentHistory,
}));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity: mocks.getFieldsForEntity }));

// Блоки подменены заглушками: здесь проверяется, КАКИЕ блоки страница собирает
// и с чем, а не их вёрстка — у каждого свой тест.
vi.mock('@/components/documents/document-detail-view', () => ({
  DocumentDetailView: (props: { children: React.ReactNode }) => (
    <div data-testid="detail">{props.children}</div>
  ),
}));
vi.mock('@/components/documents/document-onec-push-block', () => ({
  DocumentOneCPushBlock: (props: { pushedVersionInOneC: number | null }) => (
    <div data-testid="push-block" data-pushed={String(props.pushedVersionInOneC)} />
  ),
}));
vi.mock('@/components/documents/document-version-upload-form', () => ({
  DocumentVersionUploadForm: (props: { currentVersion: number }) => (
    <div data-testid="version-upload" data-version={String(props.currentVersion)} />
  ),
}));
vi.mock('@/components/documents/document-version-history', () => ({
  DocumentVersionHistory: () => <div data-testid="version-history" />,
}));
vi.mock('@/components/documents/document-downloads', () => ({
  DocumentDownloads: (props: { auditHref: string }) => (
    <div data-testid="downloads" data-audit={props.auditHref} />
  ),
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => <div data-testid="custom-fields" />,
}));

import AdminDocumentDetailPage from '@/app/admin/documents/[id]/page';

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'doc1',
  name: 'Счёт №5',
  type: 'invoice',
  version: 2,
  canUploadVersion: false,
  order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' },
  counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
  oneCPush: {
    status: 'none',
    pushedAt: null,
    error: null,
    attempts: 0,
    externalId: null,
    blocked: null,
  },
  ...over,
});

const params = Promise.resolve({ id: 'doc1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ sub: 'u1', role: 'admin', companyId: 'c1' });
  mocks.getDocumentDetail.mockResolvedValue({ ok: true, document: doc() });
  mocks.getFieldsForEntity.mockResolvedValue([]);
  mocks.getDocumentHistory.mockResolvedValue({ ok: false, error: 'not_found' });
});

describe('История документа', () => {
  it('истории нет — блоков версий и скачиваний тоже нет', async () => {
    await renderServerComponent(AdminDocumentDetailPage({ params }));

    expect(screen.queryByTestId('version-history')).toBeNull();
    expect(screen.queryByTestId('downloads')).toBeNull();
    // Версия, выгруженная в 1С, неизвестна — так и передаём.
    expect(screen.getByTestId('push-block').dataset.pushed).toBe('null');
  });

  it('история есть — видны версии, скачивания и ссылка в журнал', async () => {
    mocks.getDocumentHistory.mockResolvedValue({
      ok: true,
      history: { versions: [], downloads: [], pushedVersionInOneC: 1 },
    });

    await renderServerComponent(AdminDocumentDetailPage({ params }));

    expect(screen.getByTestId('version-history')).toBeTruthy();
    expect(screen.getByTestId('downloads').dataset.audit).toContain('/admin/');
    expect(screen.getByTestId('push-block').dataset.pushed).toBe('1');
  });
});

describe('Загрузка новой версии', () => {
  it('документу версию грузить нельзя — формы нет', async () => {
    await renderServerComponent(AdminDocumentDetailPage({ params }));

    expect(screen.queryByTestId('version-upload')).toBeNull();
  });

  it('можно — форма на месте и знает текущую версию', async () => {
    mocks.getDocumentDetail.mockResolvedValue({
      ok: true,
      document: doc({ canUploadVersion: true }),
    });

    await renderServerComponent(AdminDocumentDetailPage({ params }));

    expect(screen.getByTestId('version-upload').dataset.version).toBe('2');
  });

  it('документ без заказа формы не получает — грузить некуда', async () => {
    mocks.getDocumentDetail.mockResolvedValue({
      ok: true,
      document: doc({ canUploadVersion: true, order: null }),
    });

    await renderServerComponent(AdminDocumentDetailPage({ params }));

    expect(screen.queryByTestId('version-upload')).toBeNull();
  });
});

describe('Чужой документ', () => {
  it('отказ сервиса — «не найдено», а не пустая карточка', async () => {
    mocks.getDocumentDetail.mockResolvedValue({ ok: false, error: 'not_found' });

    await expect(renderServerComponent(AdminDocumentDetailPage({ params }))).rejects.toThrow(
      'NOTFOUND'
    );
  });
});
