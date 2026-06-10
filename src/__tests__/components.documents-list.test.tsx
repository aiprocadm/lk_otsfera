import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DocumentsList } from '@/components/partner/documents-list';

const base = { id: 'd1', name: 'gen.pdf', type: 'other' as const, direction: 'outgoing' as const,
  signedAt: null, createdAt: new Date('2026-06-01'), size: 100 };

describe('DocumentsList order-less label', () => {
  it('shows «Общий документ» when order fields are null', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: null, orderNumber: null, orderTitle: null }] as never} />);
    expect(html).toContain('Общий документ');
  });
  it('shows order reference for order-bound docs', () => {
    const html = renderToString(<DocumentsList rows={[{ ...base, orderId: 'o1', orderNumber: '№42', orderTitle: 'T' }] as never} />);
    expect(html).toContain('№42');
  });
});
