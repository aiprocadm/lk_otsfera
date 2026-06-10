import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
  usePathname: vi.fn(() => '/organization/documents'),
  useSearchParams: vi.fn(() => new URLSearchParams())
}));

vi.mock('@/server-actions/organization/documents', () => ({ uploadOrganizationDocument: vi.fn() }));

import { OrganizationOrderLessUploadForm } from '@/components/organization/organization-order-less-upload-form';

describe('OrganizationOrderLessUploadForm', () => {
  it('renders the order-less upload form', () => {
    const html = renderToString(<OrganizationOrderLessUploadForm organizationId='o1' />);
    expect(html).toContain('Загрузить общий документ');
    expect(html).toContain('name="file"');
  });
});
