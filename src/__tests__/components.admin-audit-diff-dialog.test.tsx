// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';

describe('AuditDiffDialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

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

  it('recursively masks a sensitive key nested inside a plain object (object branch of maskValue)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: { after: { profile: { apiKey: 'nested-secret-value' } } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('nested-secret-value');
    expect(html).toContain('*****');
  });

  it('recursively masks sensitive keys inside array elements (Array.isArray branch of maskValue)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: { after: { tokens: [{ token: 'array-secret' }, { token: 'array-secret-2' }] } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('array-secret');
    expect(html).toContain('*****');
  });

  it('passes through a null value unmasked (value !== null guard, false branch)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: { after: { name: null } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).toContain('&quot;name&quot;: null');
  });

  it('renders "—" placeholders when meta is null (maskedJsonString/maskedExtraJsonString !meta branch)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: null
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('Прочие meta-поля');
    // Both "До" and "После" panels fall back to the em-dash placeholder.
    const dashCount = (html.match(/>—</g) ?? []).length;
    expect(dashCount).toBe(2);
  });

  it('renders "—" placeholders when meta is a non-object primitive (typeof guard, string branch)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: 'not-an-object'
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('Прочие meta-поля');
    const dashCount = (html.match(/>—</g) ?? []).length;
    expect(dashCount).toBe(2);
  });

  it('does not render the extras block when meta has only before/after keys (extras empty branch)', () => {
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: { before: { a: 1 }, after: { a: 2 } }
    } as any;
    const html = renderToString(
      React.createElement(AuditDiffDialog, { row, onClose: () => {} })
    );
    expect(html).not.toContain('Прочие meta-поля');
  });

  it('clicking "Закрыть" calls onClose', () => {
    const onClose = vi.fn();
    const row = {
      id: 'a1', createdAt: new Date(), actor: null,
      action: 'foo', entity: 'user' as const, entityId: 'u1',
      meta: null
    } as any;
    render(React.createElement(AuditDiffDialog, { row, onClose }));
    // Both the Dialog primitive's "x" and the panel's footer button are labeled
    // "Закрыть" — the primitive's is an icon button carrying `aria-label`; select
    // the footer one (no aria-label) to disambiguate.
    const closeButtons = screen.getAllByRole('button', { name: 'Закрыть' });
    const footerClose = closeButtons.find((b) => !b.hasAttribute('aria-label'));
    fireEvent.click(footerClose!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
