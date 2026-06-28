import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';

describe('AuditDiffDialog', () => {
  it('маскирует passwordHash в meta.after', () => {
    const row = {
      id: 'a1',
      createdAt: new Date(),
      actor: null,
      action: 'user_updated',
      entity: 'user' as const,
      entityId: 'u1',
      meta: { after: { name: 'X', passwordHash: 'super-secret-bcrypt' } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );

    expect(html).not.toContain('super-secret-bcrypt');
    // Маскированное значение присутствует
    expect(html).toContain('*****');
  });

  it('маскирует token, signedUrl в meta.before', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'document' as const, entityId: 'd1',
      meta: { before: { token: 'tok-xyz', signedUrl: 'https://s/sig=secret' } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('tok-xyz');
    expect(html).not.toContain('sig=secret');
    expect(html).toContain('*****');
  });

  it('отрисовывает «Прочие meta-поля» для нестандартных ключей', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: { sentEmail: true, source: 'admin' }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).toContain('Прочие meta-поля');
  });
});
