import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ManagerOrderLessUploadForm } from '@/components/manager/manager-order-less-upload-form';

describe('ManagerOrderLessUploadForm', () => {
  it('renders picker + file input', () => {
    const html = renderToString(
      <ManagerOrderLessUploadForm organizations={[{ id: 'o1', name: 'Org One' }]} partners={[{ id: 'p1', name: 'Partner One' }]} />
    );
    expect(html).toContain('Загрузить общий документ');
    expect(html).toContain('Org One');
    expect(html).toContain('name="file"');
  });
});
